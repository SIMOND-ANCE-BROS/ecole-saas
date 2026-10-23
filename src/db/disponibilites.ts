import { and, asc, eq, gt, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { conflits, type Indisponibilite, intervalleSeance, remplacantsLibres } from "../domaine/planning/disponibilite";
import { datesDesSeances } from "../domaine/planning/seances";
import type { Tx } from "./index";
import { dureeEffective, heureEffective } from "./seances";
import { cours, discipline, fermeture, indisponibilite, intervenant, saison, seance } from "./schema";

/**
 * Indisponibilités des intervenants, conflits avec les séances et remplaçants
 * libres. Toujours avec la transaction d'`avecEcole()` (RLS).
 */

const ECOLE_COURANTE = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const estUuid = (v: string) => z.uuid().safeParse(v).success;
export type Resultat = { ok: true; id: string } | { ok: false; message: string };

export type IndisponibiliteFiche = {
  id: string;
  debut: Date;
  fin: Date;
  origine: "saisie" | "google" | "microsoft";
  libelle: string | null;
};

/** Indisponibilités d'un intervenant qui ne sont pas terminées à `depuis`, par début. */
export function listerIndisponibilites(tx: Tx, intervenantId: string, depuis: Date): Promise<IndisponibiliteFiche[]> {
  if (!estUuid(intervenantId)) return Promise.resolve([]);
  return tx
    .select({
      id: indisponibilite.id,
      debut: indisponibilite.debut,
      fin: indisponibilite.fin,
      origine: indisponibilite.origine,
      libelle: indisponibilite.libelle,
    })
    .from(indisponibilite)
    .where(and(eq(indisponibilite.intervenantId, intervenantId), gt(indisponibilite.fin, depuis)))
    .orderBy(asc(indisponibilite.debut));
}

/** Indisponibilité saisie par la direction. */
export async function ajouterIndisponibilite(
  tx: Tx,
  intervenantId: string,
  saisie: { debut: Date; fin: Date; libelle: string | null },
): Promise<Resultat> {
  if (!estUuid(intervenantId)) return { ok: false, message: "Intervenant introuvable." };
  if (!(saisie.fin > saisie.debut)) return { ok: false, message: "La fin doit suivre le début." };
  const [i] = await tx.select({ id: intervenant.id }).from(intervenant).where(eq(intervenant.id, intervenantId));
  if (!i) return { ok: false, message: "Intervenant introuvable." };
  const [{ id }] = await tx
    .insert(indisponibilite)
    .values({
      ...saisie,
      libelle: saisie.libelle?.trim() || null,
      intervenantId,
      origine: "saisie",
      ecoleId: ECOLE_COURANTE,
    })
    .returning({ id: indisponibilite.id });
  return { ok: true, id };
}

/** Retire une indisponibilité saisie ; celles d'un agenda reviennent à la synchronisation suivante. */
export async function supprimerIndisponibilite(tx: Tx, id: string): Promise<Resultat> {
  const refus = { ok: false as const, message: "Cette indisponibilité n’existe plus ou vient d’un agenda." };
  if (!estUuid(id)) return refus;
  const lignes = await tx
    .delete(indisponibilite)
    .where(and(eq(indisponibilite.id, id), eq(indisponibilite.origine, "saisie")))
    .returning({ id: indisponibilite.id });
  return lignes.length === 1 ? { ok: true, id } : refus;
}

/**
 * Remplace les plages lues dans l'agenda d'un intervenant sur une fenêtre de
 * temps (synchronisation) ; les indisponibilités saisies ne sont pas touchées.
 */
export async function remplacerIndisponibilitesAgenda(
  tx: Tx,
  intervenantId: string,
  origine: "google" | "microsoft",
  fenetre: { debut: Date; fin: Date },
  plages: { debut: Date; fin: Date }[],
): Promise<number> {
  await tx
    .delete(indisponibilite)
    .where(
      and(
        eq(indisponibilite.intervenantId, intervenantId),
        ne(indisponibilite.origine, "saisie"),
        lt(indisponibilite.debut, fenetre.fin),
        gt(indisponibilite.fin, fenetre.debut),
      ),
    );
  const valides = plages.filter((p) => p.fin > p.debut);
  if (valides.length > 0) {
    await tx
      .insert(indisponibilite)
      .values(valides.map((p) => ({ ...p, intervenantId, origine, ecoleId: ECOLE_COURANTE })));
  }
  return valides.length;
}

/** Indisponibilités (de tous ou de certains intervenants) qui touchent une période. */
async function indisposEntre(tx: Tx, debut: Date, fin: Date, intervenantIds?: string[]): Promise<Indisponibilite[]> {
  if (intervenantIds && intervenantIds.length === 0) return [];
  return tx
    .select({ intervenantId: indisponibilite.intervenantId, debut: indisponibilite.debut, fin: indisponibilite.fin })
    .from(indisponibilite)
    .where(
      and(
        lt(indisponibilite.debut, fin),
        gt(indisponibilite.fin, debut),
        intervenantIds ? inArray(indisponibilite.intervenantId, intervenantIds) : undefined,
      ),
    );
}

const JOUR = 86_400_000;
/** Période large (un jour de marge de chaque côté) couvrant des dates `YYYY-MM-DD` triées. */
const periode = (dates: string[]) => ({
  debut: new Date(Date.parse(dates[0]) - JOUR),
  fin: new Date(Date.parse(dates[dates.length - 1]) + 2 * JOUR),
});

/**
 * Dates à venir où un créneau hebdomadaire tomberait pendant une
 * indisponibilité de l'intervenant (formulaire de cours, avant enregistrement).
 */
export async function conflitsCreneau(
  tx: Tx,
  saisie: { saisonId: string; intervenantId: string; jourSemaine: number; heureDebut: string; dureeMinutes: number },
  aujourdhui: string,
): Promise<string[]> {
  if (!estUuid(saisie.saisonId) || !estUuid(saisie.intervenantId)) return [];
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(saisie.heureDebut) || !(saisie.dureeMinutes > 0)) return [];
  if (!Number.isInteger(saisie.jourSemaine) || saisie.jourSemaine < 1 || saisie.jourSemaine > 7) return [];
  const [s] = await tx
    .select({ debut: saison.dateDebut, fin: saison.dateFin })
    .from(saison)
    .where(eq(saison.id, saisie.saisonId));
  if (!s) return [];
  const fermetures = await tx
    .select({ debut: fermeture.debut, fin: fermeture.fin })
    .from(fermeture)
    .where(eq(fermeture.saisonId, saisie.saisonId));
  const dates = datesDesSeances({
    debut: s.debut > aujourdhui ? s.debut : aujourdhui,
    fin: s.fin,
    jourSemaine: saisie.jourSemaine,
    fermetures,
  });
  if (dates.length === 0) return [];
  const { debut, fin } = periode(dates);
  const indispos = await indisposEntre(tx, debut, fin, [saisie.intervenantId]);
  const seances = dates.map((date) => ({
    id: date,
    date,
    heureDebut: saisie.heureDebut,
    dureeMinutes: saisie.dureeMinutes,
    intervenantId: saisie.intervenantId,
  }));
  return conflits(seances, indispos).map((c) => c.seanceId);
}

/** Séances prévues d'un cours, à partir d'aujourd'hui, dont l'intervenant est indisponible. */
export async function seancesEnConflit(tx: Tx, coursId: string, aujourdhui: string): Promise<Set<string>> {
  if (!estUuid(coursId)) return new Set();
  const lignes = await tx
    .select({
      id: seance.id,
      date: seance.date,
      heureDebut: heureEffective,
      dureeMinutes: dureeEffective,
      intervenantId: seance.intervenantId,
    })
    .from(seance)
    .innerJoin(cours, eq(cours.id, seance.coursId))
    .where(and(eq(seance.coursId, coursId), gte(seance.date, aujourdhui), eq(seance.statut, "prevue")))
    .orderBy(asc(seance.date));
  if (lignes.length === 0) return new Set();
  const seances = lignes.map((l) => ({ ...l, heureDebut: l.heureDebut.slice(0, 5) }));
  const { debut, fin } = periode(seances.map((s) => s.date));
  const indispos = await indisposEntre(tx, debut, fin, [...new Set(seances.map((s) => s.intervenantId))]);
  return new Set(conflits(seances, indispos).map((c) => c.seanceId));
}

export type Remplacant = {
  id: string;
  nom: string;
  libre: boolean;
  motif: "indisponible" | "autre séance" | null;
  enseigne: boolean;
};

/**
 * Pour une séance : son intervenant est-il indisponible, et quels intervenants
 * actifs pourraient la reprendre (libres d'abord, la discipline en tête).
 */
export async function disponibilitesSeance(
  tx: Tx,
  seanceId: string,
): Promise<{ indisponible: boolean; remplacants: Remplacant[] } | null> {
  if (!estUuid(seanceId)) return null;
  const [s] = await tx
    .select({
      id: seance.id,
      date: seance.date,
      heureDebut: heureEffective,
      dureeMinutes: dureeEffective,
      intervenantId: seance.intervenantId,
      discipline: discipline.nom,
      saisonId: cours.saisonId,
    })
    .from(seance)
    .innerJoin(cours, eq(cours.id, seance.coursId))
    .innerJoin(discipline, eq(discipline.id, cours.disciplineId))
    .where(eq(seance.id, seanceId));
  if (!s) return null;
  const cible = { ...s, heureDebut: s.heureDebut.slice(0, 5) };
  const [debut, fin] = intervalleSeance(cible);

  const actifs = await tx
    .select({
      id: intervenant.id,
      prenom: intervenant.prenom,
      nom: intervenant.nom,
      disciplines: sql<string[]>`coalesce((
        SELECT array_agg(DISTINCT d.name) FROM course c JOIN discipline d ON d.id = c.discipline_id
        WHERE c.instructor_id = ${intervenant}.${sql.identifier("id")} AND c.season_id = ${s.saisonId}
      ), '{}')`,
    })
    .from(intervenant)
    .where(eq(intervenant.actif, true))
    .orderBy(asc(intervenant.prenom), asc(intervenant.nom));

  const memeJour = await tx
    .select({
      id: seance.id,
      date: seance.date,
      heureDebut: heureEffective,
      dureeMinutes: dureeEffective,
      intervenantId: seance.intervenantId,
    })
    .from(seance)
    .innerJoin(cours, eq(cours.id, seance.coursId))
    .where(and(eq(seance.date, s.date), ne(seance.statut, "annulee")));
  const indispos = await indisposEntre(tx, new Date(debut), new Date(fin));

  const noms = new Map(actifs.map((a) => [a.id, `${a.prenom} ${a.nom}`]));
  const classes = remplacantsLibres(
    cible,
    actifs.map((a) => ({ id: a.id, disciplines: a.disciplines })),
    memeJour.map((m) => ({ ...m, heureDebut: m.heureDebut.slice(0, 5) })),
    indispos,
  );
  return {
    indisponible: conflits([cible], indispos).length > 0,
    remplacants: classes.map((r) => ({ ...r, nom: noms.get(r.id) ?? "" })),
  };
}
