"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withSchool } from "@/db";
import { createCalendarToken, revokeCalendarToken } from "@/db/calendar-feed";
import { deleteConnection } from "@/db/calendar-connections";
import { addUnavailability, deleteUnavailability } from "@/db/unavailabilities";
import { createInstructor, updateInstructor, validInstructorInput } from "@/db/instructors";
import { todayInParis } from "@/domain/people/age";
import { instantParis } from "@/domain/schedule/availability";
import { personalPage } from "@/lib/public-calendar";
import { parseEuros } from "@/lib/money";
import { requireRole } from "@/lib/session";
import { logSyncException, syncCalendar, SYNC_UNAVAILABLE } from "@/lib/calendar-sync";
import { topErrorsOf } from "@/lib/form-errors";
import { INSTRUCTOR, type InstructorField } from "./fields";

export type FormState = {
  /** Incremented on each rejection: the form is remounted with the returned input. */
  attempt: number;
  /** Per field, plus `form` for a message about the whole form. */
  errors: Partial<Record<InstructorField | "form", string>>;
  values: Record<InstructorField, string> | null;
};

/** Creates (null id) or updates an instructor; management only. */
export async function saveInstructor(id: string | null, state: FormState, f: FormData): Promise<FormState> {
  const { schoolId: schoolId, userId } = await requireRole("director");
  const read = (n: InstructorField) => INSTRUCTOR.read(f, n);
  const values = {
    firstName: read("firstName"),
    name: read("name"),
    email: read("email"),
    status: read("status"),
    siren: read("siren"),
    vatRegime: read("vatRegime"),
    payMode: read("payMode"),
    tariff: read("tariff"),
  };
  const rateCents = parseEuros(values.tariff);
  const parsed = validInstructorInput.safeParse({
    ...values,
    rateCents: rateCents ?? -1,
    isOwner: read("isOwner") === "on",
    active: id === null || read("active") === "on",
  });
  const refusal = (errors: FormState["errors"]) => ({
    attempt: state.attempt + 1,
    errors: errors,
    values: { ...values, isOwner: read("isOwner"), active: read("active") },
  });
  if (!parsed.success) {
    // The rate is typed in euros in the « tariff » field and validated in cents.
    const { rateCents, ...errors } = topErrorsOf(parsed.error);
    return refusal(rateCents ? { ...errors, tariff: "Montant en euros, par exemple 35 ou 35,50" } : errors);
  }

  const result = await withSchool(schoolId, async (tx) => {
    if (id === null) return { ok: true as const, id: await createInstructor(tx, parsed.data) };
    const r = await updateInstructor(tx, id, parsed.data, todayInParis(), userId);
    return r.ok ? { ok: true as const, id } : r;
  });
  if (!result.ok) return refusal({ form: result.message });
  redirect(`/intervenants?enregistre=${result.id}`);
}

/** Public address of the application, taken from the request (behind a proxy: X-Forwarded-* headers). */
async function source(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const protocol = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

/** Creates or replaces the calendar subscription link; the address is shown only once. */
export async function createCalendarLink(
  instructorId: string,
): Promise<{ url: string; page: string } | { message: string }> {
  const { schoolId: schoolId } = await requireRole("director");
  const token = await withSchool(schoolId, (tx) => createCalendarToken(tx, instructorId));
  if (!token) return { message: "Cet intervenant n’existe plus." };
  revalidatePath(`/intervenants/${instructorId}`);
  const base = await source();
  return { url: `${base}/agenda/${schoolId}/${token}.ics`, page: `${base}${personalPage(schoolId, token)}` };
}

export async function revokeCalendarLink(instructorId: string): Promise<{ message: string | null }> {
  const { schoolId: schoolId } = await requireRole("director");
  const ok = await withSchool(schoolId, (tx) => revokeCalendarToken(tx, instructorId));
  revalidatePath(`/intervenants/${instructorId}`);
  return { message: ok ? null : "Cet intervenant n’existe plus." };
}

const unavailabilityInput = z
  .object({
    fromDate: z.iso.date("Date de début invalide"),
    toDate: z.iso.date("Date de fin invalide"),
    fromTime: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide")]),
    toTime: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide")]),
    label: z.string().max(100),
  })
  .refine(
    (s) => (s.fromTime === "") === (s.toTime === ""),
    "Indiquez les deux heures, ou aucune pour des journées entières.",
  );

/** Whole days (no times) or a time range, in Paris time. */
export async function addUnavailabilityAction(
  instructorId: string,
  entry: unknown,
): Promise<{ message: string | null }> {
  const { schoolId: schoolId } = await requireRole("director");
  const s = unavailabilityInput.safeParse(entry);
  if (!s.success) return { message: s.error.issues[0].message };
  const { fromDate, toDate, fromTime, toTime, label } = s.data;
  const nextDay = new Date(Date.parse(toDate) + 86_400_000).toISOString().slice(0, 10);
  const start = new Date(instantParis(fromDate, fromTime || "00:00"));
  const end = new Date(fromTime ? instantParis(toDate, toTime) : instantParis(nextDay, "00:00"));
  const r = await withSchool(schoolId, (tx) => addUnavailability(tx, instructorId, { start, end, label }));
  revalidatePath(`/intervenants/${instructorId}`);
  return { message: r.ok ? null : r.message };
}

export async function removeUnavailability(instructorId: string, id: string): Promise<{ message: string | null }> {
  const { schoolId: schoolId } = await requireRole("director");
  const r = await withSchool(schoolId, (tx) => deleteUnavailability(tx, id));
  revalidatePath(`/intervenants/${instructorId}`);
  return { message: r.ok ? null : r.message };
}

/**
 * Button « Synchroniser maintenant ». A sync that throws (its connection unreadable, or its own
 * error not recorded) answers the usual French message instead of an error page (#377).
 */
export async function syncNow(
  instructorId: string,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const { schoolId: schoolId } = await requireRole("director");
  // The id comes from the browser: checked before it reaches the database or the logs.
  if (!z.uuid().safeParse(instructorId).success) return { ok: false, message: "Intervenant introuvable." };
  let r: Awaited<ReturnType<typeof syncCalendar>>;
  try {
    r = await syncCalendar(schoolId, instructorId);
  } catch (e: unknown) {
    logSyncException(schoolId, instructorId, e);
    r = { ok: false, message: SYNC_UNAVAILABLE };
  }
  revalidatePath(`/intervenants/${instructorId}`);
  if (!r.ok) return { ok: false, message: r.message };
  return {
    ok: true,
    message: `Agenda mis à jour : ${r.ranges} plage${r.ranges > 1 ? "s" : ""} occupée${r.ranges > 1 ? "s" : ""}.`,
  };
}

export async function disconnectCalendar(instructorId: string): Promise<{ message: string }> {
  const { schoolId: schoolId } = await requireRole("director");
  const ok = await withSchool(schoolId, (tx) => deleteConnection(tx, instructorId));
  revalidatePath(`/intervenants/${instructorId}`);
  return { message: ok ? "Agenda déconnecté." : "Aucun agenda connecté." };
}
