"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withSchool } from "@/db";
import { createCalendarToken, revokeCalendarToken } from "@/db/agenda";
import { deleteConnection } from "@/db/connexions-agenda";
import { addUnavailability, deleteUnavailability } from "@/db/disponibilites";
import { createInstructor, updateInstructor, validInstructorInput } from "@/db/intervenants";
import { instantParis } from "@/domaine/planning/disponibilite";
import { personalPage } from "@/lib/agenda-public";
import { parseEuros } from "@/lib/montant";
import { requireRole } from "@/lib/session";
import { syncCalendar } from "@/lib/synchro-agenda";

export type FormState = {
  /** Incrémenté à chaque refus : le formulaire est remonté avec la saisie renvoyée. */
  attempt: number;
  errors: Partial<Record<string, string>>;
  values: Record<string, string> | null;
};

const texte = (f: FormData, name: string) => String(f.get(name) ?? "");

/** Crée (id null) ou modifie un intervenant ; réservé à la direction. */
export async function saveInstructor(id: string | null, state: FormState, f: FormData): Promise<FormState> {
  const { schoolId: schoolId } = await requireRole("direction");
  const values = Object.fromEntries(
    ["firstName", "name", "email", "status", "siren", "vatRegime", "payMode", "tariff"].map((n) => [n, texte(f, n)]),
  );
  const rateCents = parseEuros(values.tariff);
  const donnees = validInstructorInput.safeParse({
    ...values,
    rateCents: rateCents ?? -1,
    isOwner: f.get("isOwner") === "on",
    active: id === null || f.get("active") === "on",
  });
  const refusal = (errors: FormState["errors"]) => ({
    attempt: state.attempt + 1,
    errors: errors,
    values: { ...values, isOwner: texte(f, "isOwner"), active: texte(f, "active") },
  });
  if (!donnees.success) {
    const errors: FormState["errors"] = {};
    for (const p of donnees.error.issues) errors[String(p.path[0])] ??= p.message;
    if (errors.rateCents) errors.tariff = "Montant en euros, par exemple 35 ou 35,50";
    return refusal(errors);
  }

  const result = await withSchool(schoolId, async (tx) =>
    id === null ? createInstructor(tx, donnees.data) : (await updateInstructor(tx, id, donnees.data)) ? id : null,
  );
  if (result === null) return refusal({ form: "Cet intervenant n’existe plus." });
  redirect(`/intervenants?enregistre=${result}`);
}

/** Adresse publique de l'application, prise sur la requête (derrière un proxy : en-têtes X-Forwarded-*). */
async function source(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const protocol = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

/** Crée ou remplace le lien d'abonnement à l'agenda ; l'adresse n'est montrée qu'une fois. */
export async function createCalendarLink(
  instructorId: string,
): Promise<{ url: string; page: string } | { message: string }> {
  const { schoolId: schoolId } = await requireRole("direction");
  const token = await withSchool(schoolId, (tx) => createCalendarToken(tx, instructorId));
  if (!token) return { message: "Cet intervenant n’existe plus." };
  revalidatePath(`/intervenants/${instructorId}`);
  const base = await source();
  return { url: `${base}/agenda/${schoolId}/${token}.ics`, page: `${base}${personalPage(schoolId, token)}` };
}

export async function revokeCalendarLink(instructorId: string): Promise<{ message: string | null }> {
  const { schoolId: schoolId } = await requireRole("direction");
  const ok = await withSchool(schoolId, (tx) => revokeCalendarToken(tx, instructorId));
  revalidatePath(`/intervenants/${instructorId}`);
  return { message: ok ? null : "Cet intervenant n’existe plus." };
}

const unavailabilityInput = z
  .object({
    du: z.iso.date("Date de début invalide"),
    au: z.iso.date("Date de fin invalide"),
    de: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide")]),
    a: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide")]),
    label: z.string().max(100),
  })
  .refine((s) => (s.de === "") === (s.a === ""), "Indiquez les deux heures, ou aucune pour des journées entières.");

/** Journées entières (sans heures) ou plage horaire, en heure de Paris. */
export async function addUnavailabilityAction(
  instructorId: string,
  saisie: unknown,
): Promise<{ message: string | null }> {
  const { schoolId: schoolId } = await requireRole("direction");
  const s = unavailabilityInput.safeParse(saisie);
  if (!s.success) return { message: s.error.issues[0].message };
  const { du, au, de, a, label: label } = s.data;
  const nextDay = new Date(Date.parse(au) + 86_400_000).toISOString().slice(0, 10);
  const start = new Date(instantParis(du, de || "00:00"));
  const end = new Date(de ? instantParis(au, a) : instantParis(nextDay, "00:00"));
  const r = await withSchool(schoolId, (tx) => addUnavailability(tx, instructorId, { start, end, label: label }));
  revalidatePath(`/intervenants/${instructorId}`);
  return { message: r.ok ? null : r.message };
}

export async function removeUnavailability(instructorId: string, id: string): Promise<{ message: string | null }> {
  const { schoolId: schoolId } = await requireRole("direction");
  const r = await withSchool(schoolId, (tx) => deleteUnavailability(tx, id));
  revalidatePath(`/intervenants/${instructorId}`);
  return { message: r.ok ? null : r.message };
}

export async function syncNow(instructorId: string): Promise<{ message: string }> {
  const { schoolId: schoolId } = await requireRole("direction");
  const r = await syncCalendar(schoolId, instructorId);
  revalidatePath(`/intervenants/${instructorId}`);
  return {
    message: r.ok
      ? `Agenda mis à jour : ${r.ranges} plage${r.ranges > 1 ? "s" : ""} occupée${r.ranges > 1 ? "s" : ""}.`
      : r.message,
  };
}

export async function disconnectCalendar(instructorId: string): Promise<{ message: string }> {
  const { schoolId: schoolId } = await requireRole("direction");
  const ok = await withSchool(schoolId, (tx) => deleteConnection(tx, instructorId));
  revalidatePath(`/intervenants/${instructorId}`);
  return { message: ok ? "Agenda déconnecté." : "Aucun agenda connecté." };
}
