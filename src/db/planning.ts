import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { datesDuCoursSql } from "./cours";
import type { Tx } from "./index";
import { alias } from "drizzle-orm/pg-core";
import { nomAffiche } from "./personnes";
import { cours, discipline, inscription, inscriptionCours, intervenant, personne, saison, salle, site } from "./schema";

/** Lectures du planning, toujours avec la transaction d'`avecEcole()` (RLS). */

export type Saison = { id: string; libelle: string; dateDebut: string; dateFin: string };

/** Saison qui contient le jour (`YYYY-MM-DD`), sinon la plus récente ; null s'il n'y en a aucune. */
export async function saisonCourante(tx: Tx, jour: string): Promise<Saison | null> {
  const [s] = await tx
    .select({ id: saison.id, libelle: saison.libelle, dateDebut: saison.dateDebut, dateFin: saison.dateFin })
    .from(saison)
    .orderBy(sql`(${saison.dateDebut} <= ${jour} AND ${saison.dateFin} >= ${jour}) DESC`, desc(saison.dateDebut))
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
  WHERE ic.course_id = ${cours}.${sql.identifier("id")}
)`;

/** Cours d'une saison, par jour puis par heure. */
export function coursDeLaSaison(tx: Tx, saisonId: string): Promise<CoursPlanning[]> {
  return lireCoursPlanning(tx, eq(cours.saisonId, saisonId));
}

/** Un cours du planning, ou null s'il n'existe pas dans l'école courante. */
export async function coursDuPlanning(tx: Tx, id: string): Promise<CoursPlanning | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [c] = await lireCoursPlanning(tx, eq(cours.id, id));
  return c ?? null;
}

async function lireCoursPlanning(tx: Tx, filtre: SQL): Promise<CoursPlanning[]> {
  const lignes = await tx
    .select({
      id: cours.id,
      jourSemaine: cours.jourSemaine,
      heureDebut: cours.heureDebut,
      dureeMinutes: cours.dureeMinutes,
      disciplineId: cours.disciplineId,
      discipline: discipline.nom,
      salleId: cours.salleId,
      salle: salle.nom,
      siteId: site.id,
      site: site.nom,
      recurrence: cours.recurrence,
      dateDebut: cours.dateDebut,
      dateFin: cours.dateFin,
      dates: datesDuCoursSql,
      intervenantId: cours.intervenantId,
      prenom: intervenant.prenom,
      nom: intervenant.nom,
      ageMin: cours.ageMin,
      ageMax: cours.ageMax,
      niveau: cours.niveau,
      capaciteMax: cours.capaciteMax,
      inscrits: effectif,
    })
    .from(cours)
    .innerJoin(discipline, eq(discipline.id, cours.disciplineId))
    .innerJoin(salle, eq(salle.id, cours.salleId))
    .innerJoin(site, eq(site.id, salle.siteId))
    .innerJoin(intervenant, eq(intervenant.id, cours.intervenantId))
    .where(filtre)
    .orderBy(sql`${cours.jourSemaine} NULLS LAST`, asc(cours.heureDebut), asc(discipline.nom));

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
  const danseur = alias(personne, "danseur");
  const payeur = alias(personne, "payeur");
  const lignes = await tx
    .selectDistinctOn([danseur.nom, danseur.prenom, danseur.id], {
      danseurId: danseur.id,
      prenom: danseur.prenom,
      nom: danseur.nom,
      dateNaissance: danseur.dateNaissance,
      payeurId: payeur.id,
      payeurNom: payeur.nom,
      payeurPrenom: payeur.prenom,
      raisonSociale: payeur.raisonSociale,
      // Téléphone du danseur, sinon celui de son payeur (un enfant n'en a souvent pas).
      telephone: sql<string | null>`coalesce(${danseur.telephone}, ${payeur.telephone})`,
      email: sql<string | null>`coalesce(${danseur.email}, ${payeur.email})`,
      statut: sql<Inscrit["statut"]>`${inscription.statut}`,
      dateInscription: inscription.dateInscription,
    })
    .from(inscriptionCours)
    .innerJoin(inscription, eq(inscription.id, inscriptionCours.inscriptionId))
    .innerJoin(danseur, eq(danseur.id, inscriptionCours.danseurId))
    .innerJoin(payeur, eq(payeur.id, inscription.payeurId))
    .where(
      and(eq(inscriptionCours.coursId, coursId), inArray(inscription.statut, ["active", "essai", "liste_attente"])),
    )
    .orderBy(asc(danseur.nom), asc(danseur.prenom), asc(danseur.id), sql`${inscription.statut} = 'active' DESC`);
  return lignes.map(({ payeurNom, payeurPrenom, raisonSociale, prenom, ...l }) => ({
    ...l,
    prenom: prenom ?? "",
    payeur: nomAffiche({ nom: payeurNom, prenom: payeurPrenom, raisonSociale }),
  }));
}
