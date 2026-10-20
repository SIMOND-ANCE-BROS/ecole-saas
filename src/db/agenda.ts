import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { SeanceAgenda } from "../domaine/planning/ical";
import type { Tx } from "./index";
import { cours, discipline, ecole, intervenant, salle, seance, site } from "./schema";

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
    .update(intervenant)
    .set({ jetonAgendaHash: empreinte(jeton), jetonAgendaCreeLe: sql`now()` })
    .where(eq(intervenant.id, intervenantId))
    .returning({ id: intervenant.id });
  return lignes.length === 1 ? jeton : null;
}

export async function revoquerJetonAgenda(tx: Tx, intervenantId: string): Promise<boolean> {
  if (!z.uuid().safeParse(intervenantId).success) return false;
  const lignes = await tx
    .update(intervenant)
    .set({ jetonAgendaHash: null, jetonAgendaCreeLe: null })
    .where(eq(intervenant.id, intervenantId))
    .returning({ id: intervenant.id });
  return lignes.length === 1;
}

/** Date de création du lien en cours, ou null s'il n'y en a pas. */
export async function etatAgenda(tx: Tx, intervenantId: string): Promise<Date | null> {
  if (!z.uuid().safeParse(intervenantId).success) return null;
  const [i] = await tx.select({ creeLe: intervenant.jetonAgendaCreeLe }).from(intervenant).where(eq(intervenant.id, intervenantId));
  return i?.creeLe ?? null;
}

/**
 * Séances de l'intervenant au jeton donné, à partir de `depuis`, y compris ses
 * remplacements ; null si le jeton est inconnu ou révoqué. Aucune donnée
 * d'élève : titre du cours et lieu seulement.
 */
export async function lireAgenda(tx: Tx, jeton: string, depuis: string): Promise<{ nom: string; seances: SeanceAgenda[] } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(jeton)) return null;
  const [i] = await tx
    .select({ id: intervenant.id, prenom: intervenant.prenom, ecole: ecole.nom })
    .from(intervenant)
    .innerJoin(ecole, eq(ecole.id, intervenant.ecoleId))
    .where(eq(intervenant.jetonAgendaHash, empreinte(jeton)));
  if (!i) return null;

  const lignes = await tx
    .select({
      id: seance.id,
      date: seance.date,
      statut: seance.statut,
      heureDebut: cours.heureDebut,
      dureeMinutes: cours.dureeMinutes,
      discipline: discipline.nom,
      niveau: cours.niveau,
      salle: salle.nom,
      site: site.nom,
      adresse: site.adresse,
    })
    .from(seance)
    .innerJoin(cours, eq(cours.id, seance.coursId))
    .innerJoin(discipline, eq(discipline.id, cours.disciplineId))
    .innerJoin(salle, eq(salle.id, cours.salleId))
    .innerJoin(site, eq(site.id, salle.siteId))
    .where(and(eq(seance.intervenantId, i.id), gte(seance.date, depuis)))
    .orderBy(asc(seance.date), asc(cours.heureDebut));

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
