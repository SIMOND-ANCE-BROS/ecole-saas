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
  audience: z.enum(["enfant", "adulte", "couple", "etudiant"]),
  period: z.enum(["trimestre", "annee", "unite"]),
  courseIds: z.array(z.uuid()).max(10),
});

export type FormInput = z.infer<typeof validInput>;

const NO_SEASON_MESSAGE = "Aucune saison n’est paramétrée.";
const WITHOUT_SEASON: Preview = { status: "invalide", message: NO_SEASON_MESSAGE };

/** Aperçu du prix, recalculé côté serveur à chaque changement de la saisie. */
export async function preview(saisie: FormInput): Promise<Preview> {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const donnees = validInput.safeParse(saisie);
  if (!donnees.success) return { status: "invalide", message: "Saisie invalide." };
  const { payerId: payerId, ...reste } = donnees.data;
  return withSchool(schoolId, async (tx) => {
    const season = await currentSeason(tx, todayInParis());
    return season ? enrollmentPreview(tx, payerId, season.id, reste) : WITHOUT_SEASON;
  });
}

/** Enregistre l'inscription ; en cas de refus, renvoie le message à afficher. */
export async function enroll(saisie: FormInput): Promise<{ message: string }> {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const donnees = validInput.safeParse(saisie);
  if (!donnees.success) return { message: "Saisie invalide." };
  const { payerId: payerId, ...reste } = donnees.data;
  const result = await withSchool(schoolId, async (tx) => {
    const season = await currentSeason(tx, todayInParis());
    if (!season) return { ok: false as const, message: NO_SEASON_MESSAGE };
    return saveEnrollment(tx, payerId, season.id, reste);
  });
  if (!result.ok) return { message: result.message };
  redirect(`/eleves/${reste.studentIds[0]}?inscription=enregistree`);
}
