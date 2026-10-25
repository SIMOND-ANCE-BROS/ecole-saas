"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { withSchool } from "@/db";
import { type Preview, enrollmentPreview, saveEnrollment } from "@/db/enrollments";
import { currentSeason } from "@/db/schedule";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";

const validInput = z.object({
  payerId: z.uuid(),
  studentIds: z.array(z.uuid()).max(2),
  audience: z.enum(["child", "adult", "couple", "student"]),
  period: z.enum(["quarter", "year", "single"]),
  courseIds: z.array(z.uuid()).max(10),
});

export type FormInput = z.infer<typeof validInput>;

const NO_SEASON_MESSAGE = "Aucune saison n’est paramétrée.";
const WITHOUT_SEASON: Preview = { status: "invalid", message: NO_SEASON_MESSAGE };

/** Price preview, recomputed on the server on every change to the input. */
export async function preview(entry: FormInput): Promise<Preview> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const parsed = validInput.safeParse(entry);
  if (!parsed.success) return { status: "invalid", message: "Saisie invalide." };
  const { payerId: payerId, ...rest } = parsed.data;
  return withSchool(schoolId, async (tx) => {
    const season = await currentSeason(tx, todayInParis());
    return season ? enrollmentPreview(tx, payerId, season.id, rest) : WITHOUT_SEASON;
  });
}

/** Saves the enrollment; when refused, returns the message to display. */
export async function enroll(entry: FormInput): Promise<{ message: string }> {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const parsed = validInput.safeParse(entry);
  if (!parsed.success) return { message: "Saisie invalide." };
  const { payerId: payerId, ...rest } = parsed.data;
  const result = await withSchool(schoolId, async (tx) => {
    const season = await currentSeason(tx, todayInParis());
    if (!season) return { ok: false as const, message: NO_SEASON_MESSAGE };
    return saveEnrollment(tx, payerId, season.id, rest);
  });
  if (!result.ok) return { message: result.message };
  redirect(`/eleves/${rest.studentIds[0]}?inscription=enregistree`);
}
