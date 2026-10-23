import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { datesDuCoursSql } from "./cours";
import type { Tx } from "./index";
import { alias } from "drizzle-orm/pg-core";
import { nomAffiche } from "./personnes";
import { course, discipline, enrollment, enrollmentCourse, instructor, person, season, room, site } from "./schema";

/** Lectures du planning, toujours avec la transaction d'`avecEcole()` (RLS). */

export type Saison = { id: string; libelle: string; dateDebut: string; dateFin: string };

/** Saison qui contient le jour (`YYYY-MM-DD`), sinon la plus récente ; null s'il n'y en a aucune. */
export async function saisonCourante(tx: Tx, jour: string): Promise<Saison | null> {
  const [s] = await tx
    .select({ id: season.id, libelle: season.label, dateDebut: season.startDate, dateFin: season.endDate })
    .from(season)
    .orderBy(sql`(${season.startDate} <= ${jour} AND ${season.endDate} >= ${jour}) DESC`, desc(season.startDate))
    .limit(1);
  return s ?? null;
}

export type CoursPlanning = {
  id: string;
  /** 1 = lundi … 7 = dimanche ; null pour un stage. */
  jourSemaine: number | null;
  /** `HH:MM` */
  heureDebut: string;
  dureeMinutes: number;
  disciplineId: string;
  discipline: string;
  salleId: string;
  salle: string;
  siteId: string;
  /** Récurrence (#90) ; `dates` : cours ponctuel, sans jour. */
  recurrence: "hebdomadaire" | "quinzaine" | "dates";
  dateDebut: string | null;
  dateFin: string | null;
  dates: string[];
  site: string;
  intervenantId: string;
  /** « Prénom Nom » */
  intervenant: string;
  ageMin: number | null;
  ageMax: number | null;
  niveau: string | null;
  capaciteMax: number | null;
  /** Danseurs distincts inscrits (inscriptions actives). */
  inscrits: number;
};

/**
 * Effectif d'un cours, écrit avec les noms de tables : dans un `select`, Drizzle
 * n'écrit pas le nom de table devant `cours.id`, qui serait ambigu ici.
 */
const effectif = sql<number>`(
  SELECT count(DISTINCT ic.student_id)::int
  FROM enrollment_course ic
  JOIN enrollment i ON i.id = ic.enrollment_id AND i.status = 'active'
  WHERE ic.course_id = ${course}.${sql.identifier("id")}
)`;

/** Cours d'une saison, par jour puis par heure. */
export function coursDeLaSaison(tx: Tx, saisonId: string): Promise<CoursPlanning[]> {
  return lireCoursPlanning(tx, eq(course.seasonId, saisonId));
}

/** Un cours du planning, ou null s'il n'existe pas dans l'école courante. */
export async function coursDuPlanning(tx: Tx, id: string): Promise<CoursPlanning | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [c] = await lireCoursPlanning(tx, eq(course.id, id));
  return c ?? null;
}

async function lireCoursPlanning(tx: Tx, filtre: SQL): Promise<CoursPlanning[]> {
  const lignes = await tx
    .select({
      id: course.id,
      jourSemaine: course.weekday,
      heureDebut: course.startTime,
      dureeMinutes: course.durationMinutes,
      disciplineId: course.disciplineId,
      discipline: discipline.name,
      salleId: course.roomId,
      salle: room.name,
      siteId: site.id,
      site: site.name,
      recurrence: course.recurrence,
      dateDebut: course.startDate,
      dateFin: course.endDate,
      dates: datesDuCoursSql,
      intervenantId: course.instructorId,
      prenom: instructor.firstName,
      nom: instructor.lastName,
      ageMin: course.ageMin,
      ageMax: course.ageMax,
      niveau: course.level,
      capaciteMax: course.maxCapacity,
      inscrits: effectif,
    })
    .from(course)
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(room, eq(room.id, course.roomId))
    .innerJoin(site, eq(site.id, room.siteId))
    .innerJoin(instructor, eq(instructor.id, course.instructorId))
    .where(filtre)
    .orderBy(sql`${course.weekday} NULLS LAST`, asc(course.startTime), asc(discipline.name));

  return lignes.map(({ prenom, nom, heureDebut, ...c }) => ({
    ...c,
    heureDebut: heureDebut.slice(0, 5),
    intervenant: `${prenom} ${nom}`,
  }));
}

export type Inscrit = {
  danseurId: string;
  prenom: string;
  nom: string;
  dateNaissance: string | null;
  payeurId: string;
  /** Nom du payeur (raison sociale pour un professionnel). */
  payeur: string;
  telephone: string | null;
  email: string | null;
  statut: "active" | "essai" | "liste_attente";
  dateInscription: string;
};

/** Danseurs du cours en cours d'année (actifs, à l'essai, en liste d'attente), par nom puis prénom. */
export async function inscritsDuCours(tx: Tx, coursId: string): Promise<Inscrit[]> {
  if (!z.uuid().safeParse(coursId).success) return [];
  const danseur = alias(person, "danseur");
  const payeur = alias(person, "payeur");
  const lignes = await tx
    .selectDistinctOn([danseur.lastName, danseur.firstName, danseur.id], {
      danseurId: danseur.id,
      prenom: danseur.firstName,
      nom: danseur.lastName,
      dateNaissance: danseur.birthDate,
      payeurId: payeur.id,
      payeurNom: payeur.lastName,
      payeurPrenom: payeur.firstName,
      raisonSociale: payeur.companyName,
      // Téléphone du danseur, sinon celui de son payeur (un enfant n'en a souvent pas).
      telephone: sql<string | null>`coalesce(${danseur.phone}, ${payeur.phone})`,
      email: sql<string | null>`coalesce(${danseur.email}, ${payeur.email})`,
      statut: sql<Inscrit["statut"]>`${enrollment.status}`,
      dateInscription: enrollment.enrolledOn,
    })
    .from(enrollmentCourse)
    .innerJoin(enrollment, eq(enrollment.id, enrollmentCourse.enrollmentId))
    .innerJoin(danseur, eq(danseur.id, enrollmentCourse.studentId))
    .innerJoin(payeur, eq(payeur.id, enrollment.payerId))
    .where(
      and(eq(enrollmentCourse.courseId, coursId), inArray(enrollment.status, ["active", "essai", "liste_attente"])),
    )
    .orderBy(asc(danseur.lastName), asc(danseur.firstName), asc(danseur.id), sql`${enrollment.status} = 'active' DESC`);
  return lignes.map(({ payeurNom, payeurPrenom, raisonSociale, prenom, ...l }) => ({
    ...l,
    prenom: prenom ?? "",
    payeur: nomAffiche({ nom: payeurNom, prenom: payeurPrenom, raisonSociale }),
  }));
}
