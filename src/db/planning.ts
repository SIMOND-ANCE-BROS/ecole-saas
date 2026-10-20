import { asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { cours, discipline, intervenant, saison, salle, site } from "./schema";

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
  salle: string;
  site: string;
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
  SELECT count(DISTINCT ic.danseur_id)::int
  FROM inscription_cours ic
  JOIN inscription i ON i.id = ic.inscription_id AND i.statut = 'active'
  WHERE ic.cours_id = ${cours}.${sql.identifier("id")}
)`;

/** Cours d'une saison, par jour puis par heure. */
export async function coursDeLaSaison(tx: Tx, saisonId: string): Promise<CoursPlanning[]> {
  const lignes = await tx
    .select({
      id: cours.id,
      jourSemaine: cours.jourSemaine,
      heureDebut: cours.heureDebut,
      dureeMinutes: cours.dureeMinutes,
      disciplineId: cours.disciplineId,
      discipline: discipline.nom,
      salle: salle.nom,
      site: site.nom,
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
    .where(eq(cours.saisonId, saisonId))
    .orderBy(sql`${cours.jourSemaine} NULLS LAST`, asc(cours.heureDebut), asc(discipline.nom));

  return lignes.map(({ prenom, nom, heureDebut, ...c }) => ({
    ...c,
    heureDebut: heureDebut.slice(0, 5),
    intervenant: `${prenom} ${nom}`,
  }));
}
