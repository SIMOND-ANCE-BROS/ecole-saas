import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { datesDuCours, type Recurrence } from "../domaine/planning/seances";
import type { Tx } from "./index";
import { cours, coursDate, discipline, fermeture, inscription, inscriptionCours, intervenant, personne, presence, saison, salle, seance } from "./schema";

/**
 * Séances (occurrences datées des cours), fermetures et appel. Toujours avec
 * la transaction d'`avecEcole()` (RLS).
 */

const ECOLE_COURANTE = sql`nullif(current_setting('app.ecole_id', true), '')::uuid`;
const estUuid = (v: string) => z.uuid().safeParse(v).success;
export type Resultat = { ok: true; id: string } | { ok: false; message: string };

/** Danseurs qui figurent à l'appel : inscrits ou à l'essai, jamais en liste d'attente. */
const STATUTS_A_L_APPEL = ["active", "essai"] as const;

// ---------------------------------------------------------------------------
// Fermetures
// ---------------------------------------------------------------------------

export type Fermeture = { id: string; libelle: string; debut: string; fin: string };

export const saisieFermetureValide = z.object({
  libelle: z.string().trim().min(1, "Libellé obligatoire").max(100),
  debut: z.iso.date("Date invalide"),
  fin: z.iso.date("Date invalide"),
});

export function listerFermetures(tx: Tx, saisonId: string): Promise<Fermeture[]> {
  return tx
    .select({ id: fermeture.id, libelle: fermeture.libelle, debut: fermeture.debut, fin: fermeture.fin })
    .from(fermeture)
    .where(eq(fermeture.saisonId, saisonId))
    .orderBy(asc(fermeture.debut));
}

export async function ajouterFermeture(tx: Tx, saisonId: string, saisie: z.input<typeof saisieFermetureValide>): Promise<Resultat> {
  const f = saisieFermetureValide.safeParse(saisie);
  if (!f.success) return { ok: false, message: f.error.issues[0].message };
  if (f.data.fin < f.data.debut) return { ok: false, message: "La fin précède le début." };
  const [{ id }] = await tx
    .insert(fermeture)
    .values({ ...f.data, saisonId, ecoleId: ECOLE_COURANTE })
    .returning({ id: fermeture.id });
  return { ok: true, id };
}

export async function supprimerFermeture(tx: Tx, id: string): Promise<Resultat> {
  const refus = { ok: false as const, message: "Cette fermeture n’existe plus." };
  if (!estUuid(id)) return refus;
  const lignes = await tx.delete(fermeture).where(eq(fermeture.id, id)).returning({ id: fermeture.id });
  return lignes.length === 1 ? { ok: true, id } : refus;
}

// ---------------------------------------------------------------------------
// Génération
// ---------------------------------------------------------------------------

const avecAppel = sql`EXISTS (SELECT 1 FROM presence p WHERE p.seance_id = ${seance}.${sql.identifier("id")})`;

/**
 * Met les séances à venir de la saison en accord avec les cours et les
 * fermetures : crée celles qui manquent (titulaire du cours) et retire les
 * séances prévues devenues sans objet. Le passé, les séances annulées et
 * celles dont l'appel est fait ne sont jamais touchés.
 */
export async function synchroniserSeances(tx: Tx, saisonId: string, aujourdhui: string): Promise<{ ajoutees: number; retirees: number }> {
  const [s] = await tx.select({ debut: saison.dateDebut, fin: saison.dateFin }).from(saison).where(eq(saison.id, saisonId));
  if (!s) return { ajoutees: 0, retirees: 0 };
  const debut = s.debut > aujourdhui ? s.debut : aujourdhui;
  const fermetures = await listerFermetures(tx, saisonId);
  const tous = await tx
    .select({
      id: cours.id,
      recurrence: cours.recurrence,
      jourSemaine: cours.jourSemaine,
      dateDebut: cours.dateDebut,
      dateFin: cours.dateFin,
      intervenantId: cours.intervenantId,
    })
    .from(cours)
    .where(eq(cours.saisonId, saisonId));
  const ponctuelles = await tx
    .select({ coursId: coursDate.coursId, date: coursDate.date })
    .from(coursDate)
    .innerJoin(cours, eq(cours.id, coursDate.coursId))
    .where(eq(cours.saisonId, saisonId));

  // Toute la saison, puis à partir de `debut` : l'alternance « une semaine sur deux » se cale sur la première date.
  const attendues = tous.flatMap((c) => {
    const r: Recurrence =
      c.recurrence === "dates"
        ? { type: "dates", dates: ponctuelles.filter((p) => p.coursId === c.id).map((p) => p.date) }
        : { type: c.recurrence, jourSemaine: c.jourSemaine as number, dateDebut: c.dateDebut, dateFin: c.dateFin };
    return datesDuCours(r, { debut: s.debut, fin: s.fin }, fermetures)
      .filter((date) => date >= debut)
      .map((date) => ({ coursId: c.id, date, intervenantId: c.intervenantId }));
  });
  const ajoutees =
    attendues.length === 0
      ? []
      : await tx
          .insert(seance)
          .values(attendues.map((a) => ({ ...a, ecoleId: ECOLE_COURANTE })))
          .onConflictDoNothing()
          .returning({ id: seance.id });

  const voulues = new Set(attendues.map((a) => `${a.coursId} ${a.date}`));
  const candidates = await tx
    .select({ id: seance.id, coursId: seance.coursId, date: seance.date })
    .from(seance)
    .innerJoin(cours, eq(cours.id, seance.coursId))
    .where(and(eq(cours.saisonId, saisonId), gte(seance.date, debut), eq(seance.statut, "prevue"), sql`NOT ${avecAppel}`));
  const aRetirer = candidates.filter((c) => !voulues.has(`${c.coursId} ${c.date}`)).map((c) => c.id);
  if (aRetirer.length > 0) await tx.delete(seance).where(inArray(seance.id, aRetirer));
  return { ajoutees: ajoutees.length, retirees: aRetirer.length };
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

const comptePresences = (present: boolean) => sql<number>`(
  SELECT count(*)::int FROM presence p WHERE p.seance_id = ${seance}.${sql.identifier("id")} AND p.present = ${present}
)`;

export type SeanceCours = {
  id: string;
  date: string;
  statut: "prevue" | "effectuee" | "annulee";
  intervenant: string;
  presents: number;
  absents: number;
};

/** Séances d'un cours, par date. */
export async function seancesDuCours(tx: Tx, coursId: string): Promise<SeanceCours[]> {
  if (!estUuid(coursId)) return [];
  const lignes = await tx
    .select({
      id: seance.id,
      date: seance.date,
      statut: seance.statut,
      prenom: intervenant.prenom,
      nom: intervenant.nom,
      presents: comptePresences(true),
      absents: comptePresences(false),
    })
    .from(seance)
    .innerJoin(intervenant, eq(intervenant.id, seance.intervenantId))
    .where(eq(seance.coursId, coursId))
    .orderBy(asc(seance.date));
  return lignes.map(({ prenom, nom, ...l }) => ({ ...l, intervenant: `${prenom} ${nom}` }));
}

export type SeanceDuJour = {
  id: string;
  coursId: string;
  heureDebut: string;
  dureeMinutes: number;
  discipline: string;
  niveau: string | null;
  salle: string;
  intervenant: string;
  statut: SeanceCours["statut"];
  appelFait: boolean;
};

/** Séances d'une journée, par heure : pour lancer l'appel depuis l'accueil. */
export async function seancesDuJour(tx: Tx, date: string): Promise<SeanceDuJour[]> {
  const lignes = await tx
    .select({
      id: seance.id,
      coursId: cours.id,
      heureDebut: cours.heureDebut,
      dureeMinutes: cours.dureeMinutes,
      discipline: discipline.nom,
      niveau: cours.niveau,
      salle: salle.nom,
      prenom: intervenant.prenom,
      nom: intervenant.nom,
      statut: seance.statut,
      appelFait: sql<boolean>`${avecAppel}`,
    })
    .from(seance)
    .innerJoin(cours, eq(cours.id, seance.coursId))
    .innerJoin(discipline, eq(discipline.id, cours.disciplineId))
    .innerJoin(salle, eq(salle.id, cours.salleId))
    .innerJoin(intervenant, eq(intervenant.id, seance.intervenantId))
    .where(eq(seance.date, date))
    .orderBy(asc(cours.heureDebut), asc(discipline.nom));
  return lignes.map(({ prenom, nom, heureDebut, ...l }) => ({ ...l, heureDebut: heureDebut.slice(0, 5), intervenant: `${prenom} ${nom}` }));
}

export type Appel = {
  id: string;
  date: string;
  statut: SeanceCours["statut"];
  coursId: string;
  discipline: string;
  niveau: string | null;
  heureDebut: string;
  dureeMinutes: number;
  salle: string;
  intervenantId: string;
  titulaireId: string;
  danseurs: {
    id: string;
    prenom: string;
    nom: string;
    dateNaissance: string | null;
    notes: string | null;
    statut: (typeof STATUTS_A_L_APPEL)[number];
    /** null tant que l'appel n'est pas fait pour ce danseur. */
    present: boolean | null;
  }[];
};

/** Fiche d'appel d'une séance ; null si elle n'existe pas dans l'école courante. */
export async function lireAppel(tx: Tx, seanceId: string): Promise<Appel | null> {
  if (!estUuid(seanceId)) return null;
  const [s] = await tx
    .select({
      id: seance.id,
      date: seance.date,
      statut: seance.statut,
      coursId: cours.id,
      discipline: discipline.nom,
      niveau: cours.niveau,
      heureDebut: cours.heureDebut,
      dureeMinutes: cours.dureeMinutes,
      salle: salle.nom,
      intervenantId: seance.intervenantId,
      titulaireId: cours.intervenantId,
    })
    .from(seance)
    .innerJoin(cours, eq(cours.id, seance.coursId))
    .innerJoin(discipline, eq(discipline.id, cours.disciplineId))
    .innerJoin(salle, eq(salle.id, cours.salleId))
    .where(eq(seance.id, seanceId));
  if (!s) return null;

  const danseurs = await tx
    .selectDistinctOn([personne.nom, personne.prenom, personne.id], {
      id: personne.id,
      prenom: personne.prenom,
      nom: personne.nom,
      dateNaissance: personne.dateNaissance,
      notes: personne.notes,
      statut: sql<Appel["danseurs"][number]["statut"]>`${inscription.statut}`,
      present: presence.present,
    })
    .from(inscriptionCours)
    .innerJoin(inscription, eq(inscription.id, inscriptionCours.inscriptionId))
    .innerJoin(personne, eq(personne.id, inscriptionCours.danseurId))
    .leftJoin(presence, and(eq(presence.seanceId, seanceId), eq(presence.danseurId, personne.id)))
    .where(and(eq(inscriptionCours.coursId, s.coursId), inArray(inscription.statut, [...STATUTS_A_L_APPEL])))
    .orderBy(asc(personne.nom), asc(personne.prenom), asc(personne.id), desc(sql`${inscription.statut} = 'active'`));

  return {
    ...s,
    heureDebut: s.heureDebut.slice(0, 5),
    danseurs: danseurs.map((d) => ({ ...d, prenom: d.prenom ?? d.nom })),
  };
}

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------

export const appelValide = z.array(z.object({ danseurId: z.uuid(), present: z.boolean() })).max(200);

/** Enregistre ou corrige l'appel ; la séance passe « effectuée ». */
export async function enregistrerAppel(tx: Tx, seanceId: string, saisie: z.input<typeof appelValide>): Promise<Resultat> {
  const lignes = appelValide.safeParse(saisie);
  if (!lignes.success) return { ok: false, message: "Saisie invalide." };
  const appel = await lireAppel(tx, seanceId);
  if (!appel) return { ok: false, message: "Cette séance n’existe plus." };
  if (appel.statut === "annulee") return { ok: false, message: "Cette séance est annulée." };
  const attendus = new Set(appel.danseurs.map((d) => d.id));
  if (!lignes.data.every((l) => attendus.has(l.danseurId))) return { ok: false, message: "Un des danseurs ne suit pas ce cours." };

  if (lignes.data.length > 0) {
    await tx
      .insert(presence)
      .values(lignes.data.map((l) => ({ ...l, seanceId, ecoleId: ECOLE_COURANTE })))
      .onConflictDoUpdate({ target: [presence.seanceId, presence.danseurId], set: { present: sql`excluded.present` } });
  }
  await tx.update(seance).set({ statut: "effectuee" }).where(eq(seance.id, seanceId));
  return { ok: true, id: seanceId };
}

/** Remplaçant (ou retour du titulaire) pour une séance ; intervenant actif seulement. */
export async function changerIntervenant(tx: Tx, seanceId: string, intervenantId: string): Promise<Resultat> {
  if (!estUuid(seanceId) || !estUuid(intervenantId)) return { ok: false, message: "Saisie invalide." };
  const [i] = await tx
    .select({ id: intervenant.id })
    .from(intervenant)
    .where(and(eq(intervenant.id, intervenantId), eq(intervenant.actif, true)));
  if (!i) return { ok: false, message: "Intervenant introuvable ou inactif." };
  const lignes = await tx.update(seance).set({ intervenantId }).where(eq(seance.id, seanceId)).returning({ id: seance.id });
  return lignes.length === 1 ? { ok: true, id: seanceId } : { ok: false, message: "Cette séance n’existe plus." };
}

/** Annule une séance dont l'appel n'est pas fait ; elle reste visible, barrée. */
export async function annulerSeance(tx: Tx, seanceId: string): Promise<Resultat> {
  const appel = await lireAppel(tx, seanceId);
  if (!appel) return { ok: false, message: "Cette séance n’existe plus." };
  if (appel.danseurs.some((d) => d.present !== null)) return { ok: false, message: "L’appel de cette séance est déjà fait." };
  await tx.update(seance).set({ statut: "annulee" }).where(eq(seance.id, seanceId));
  return { ok: true, id: seanceId };
}

/** Rétablit une séance annulée. */
export async function retablirSeance(tx: Tx, seanceId: string): Promise<Resultat> {
  if (!estUuid(seanceId)) return { ok: false, message: "Cette séance n’existe plus." };
  const lignes = await tx
    .update(seance)
    .set({ statut: "prevue" })
    .where(and(eq(seance.id, seanceId), eq(seance.statut, "annulee")))
    .returning({ id: seance.id });
  return lignes.length === 1 ? { ok: true, id: seanceId } : { ok: false, message: "Cette séance n’est pas annulée." };
}
