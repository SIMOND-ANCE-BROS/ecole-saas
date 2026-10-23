import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { SeanceAgenda } from "../domaine/planning/ical";
import type { Tx } from "./index";
import { dureeEffective, heureEffective } from "./seances";
import { course, discipline, school, instructor, room, lesson, site } from "./schema";

/**
 * Abonnement d'un intervenant à ses séances (iCal). Le jeton n'est montré
 * qu'une fois, à sa création ; seule son empreinte est gardée. Toujours avec la
 * transaction d'`avecEcole()` : l'école vient de l'adresse d'abonnement, le
 * jeton en est le secret.
 */

const empreinte = (jeton: string) => createHash("sha256").update(jeton).digest("hex");

/** Crée (ou remplace) le jeton ; l'ancien lien cesse aussitôt de fonctionner. null si l'intervenant n'existe pas. */
export async function creerJetonAgenda(tx: Tx, intervenantId: string): Promise<string | null> {
  if (!z.uuid().safeParse(intervenantId).success) return null;
  const jeton = randomBytes(32).toString("base64url");
  const lignes = await tx
    .update(instructor)
    .set({ calendarTokenHash: empreinte(jeton), calendarTokenCreatedAt: sql`now()` })
    .where(eq(instructor.id, intervenantId))
    .returning({ id: instructor.id });
  return lignes.length === 1 ? jeton : null;
}

export async function revoquerJetonAgenda(tx: Tx, intervenantId: string): Promise<boolean> {
  if (!z.uuid().safeParse(intervenantId).success) return false;
  const lignes = await tx
    .update(instructor)
    .set({ calendarTokenHash: null, calendarTokenCreatedAt: null })
    .where(eq(instructor.id, intervenantId))
    .returning({ id: instructor.id });
  return lignes.length === 1;
}

/** Date de création du lien en cours, ou null s'il n'y en a pas. */
export async function etatAgenda(tx: Tx, intervenantId: string): Promise<Date | null> {
  if (!z.uuid().safeParse(intervenantId).success) return null;
  const [i] = await tx
    .select({ creeLe: instructor.calendarTokenCreatedAt })
    .from(instructor)
    .where(eq(instructor.id, intervenantId));
  return i?.creeLe ?? null;
}

/** Intervenant actif au jeton donné (page personnelle de l'intervenant) ; null sinon. */
export async function intervenantDuJeton(
  tx: Tx,
  jeton: string,
): Promise<{ id: string; prenom: string; ecole: string } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(jeton)) return null;
  const [i] = await tx
    .select({ id: instructor.id, prenom: instructor.firstName, ecole: school.name })
    .from(instructor)
    .innerJoin(school, eq(school.id, instructor.schoolId))
    // Un intervenant parti (inactif) ne reçoit plus rien, même avec un ancien lien.
    .where(and(eq(instructor.calendarTokenHash, empreinte(jeton)), eq(instructor.active, true)));
  return i ?? null;
}

/**
 * Séances de l'intervenant au jeton donné, à partir de `depuis`, y compris ses
 * remplacements ; null si le jeton est inconnu ou révoqué. Aucune donnée
 * d'élève : titre du cours et lieu seulement.
 */
export async function lireAgenda(
  tx: Tx,
  jeton: string,
  depuis: string,
): Promise<{ nom: string; seances: SeanceAgenda[] } | null> {
  const i = await intervenantDuJeton(tx, jeton);
  if (!i) return null;

  const lignes = await tx
    .select({
      id: lesson.id,
      date: lesson.date,
      statut: lesson.status,
      heureDebut: heureEffective,
      dureeMinutes: dureeEffective,
      discipline: discipline.name,
      niveau: course.level,
      salle: room.name,
      site: site.name,
      adresse: site.address,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(room, eq(room.id, course.roomId))
    .innerJoin(site, eq(site.id, room.siteId))
    .where(and(eq(lesson.instructorId, i.id), gte(lesson.date, depuis)))
    .orderBy(asc(lesson.date), heureEffective);

  return {
    nom: `Cours de ${i.prenom}, ${i.ecole}`,
    seances: lignes.map((l) => ({
      id: l.id,
      date: l.date,
      heureDebut: l.heureDebut.slice(0, 5),
      dureeMinutes: l.dureeMinutes,
      titre: l.niveau ? `${l.discipline} ${l.niveau}` : l.discipline,
      lieu: `${l.salle}, ${l.site}, ${l.adresse}`,
      annulee: l.statut === "annulee",
    })),
  };
}
