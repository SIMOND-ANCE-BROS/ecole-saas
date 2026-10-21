import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { aRemettre, MOYENS_REMISE, type MoyenRemise } from "../domaine/encaissement/remises";
import type { Tx } from "./index";
import { dejaCorrige, type Moyen } from "./paiements";
import { journal, membre, paiement, personne, remise, remisePaiement } from "./schema";

/**
 * Journal des encaissements et remises en banque (#98). Une remise relie des
 * paiements par une table à part : le paiement, inaltérable, n'est jamais
 * modifié. Toujours avec la transaction d'`avecEcole()` (RLS).
 */

const ECOLE_COURANTE = sql`nullif(current_setting('app.ecole_id', true), '')::uuid`;
const estUuid = (v: string) => z.uuid().safeParse(v).success;
const nomPayeur = sql<string>`coalesce(${personne.raisonSociale}, concat_ws(' ', ${personne.prenom}, ${personne.nom}))`;

export type LigneJournal = {
  id: string;
  date: string;
  payeurId: string;
  payeur: string;
  moyen: Moyen;
  montantCentimes: number;
  corrigeCentimes: number;
  reference: string | null;
  emetteur: string | null;
  encaissementPrevu: string | null;
  remiseId: string | null;
  remiseDate: string | null;
};

function lignes(tx: Tx) {
  return tx
    .select({
      id: paiement.id,
      date: paiement.date,
      payeurId: paiement.payeurId,
      payeur: nomPayeur,
      moyen: paiement.moyen,
      montantCentimes: paiement.montantCentimes,
      corrigeCentimes: dejaCorrige,
      reference: paiement.reference,
      emetteur: paiement.emetteur,
      encaissementPrevu: paiement.encaissementPrevu,
      remiseId: remisePaiement.remiseId,
      remiseDate: remise.date,
    })
    .from(paiement)
    .innerJoin(personne, eq(personne.id, paiement.payeurId))
    .leftJoin(remisePaiement, eq(remisePaiement.paiementId, paiement.id))
    .leftJoin(remise, eq(remise.id, remisePaiement.remiseId));
}

/** Paiements reçus entre deux dates (incluses), éventuellement d'un seul moyen, du plus ancien au plus récent. */
export async function journalEncaissements(tx: Tx, du: string, au: string, moyen: Moyen | null): Promise<LigneJournal[]> {
  return lignes(tx)
    .where(and(sql`${paiement.date} BETWEEN ${du}::date AND ${au}::date`, moyen ? eq(paiement.moyen, moyen) : undefined))
    .orderBy(asc(paiement.date), asc(paiement.creeLe));
}

/** Chèques arrivés à échéance, espèces et chèques vacances pas encore remis, par moyen. */
export async function paiementsARemettre(tx: Tx, aujourdhui: string): Promise<Record<MoyenRemise, LigneJournal[]>> {
  const candidats = await lignes(tx)
    .where(and(inArray(paiement.moyen, [...MOYENS_REMISE]), sql`${paiement.montantCentimes} > 0`, sql`${remisePaiement.remiseId} IS NULL`))
    .orderBy(asc(sql`coalesce(${paiement.encaissementPrevu}, ${paiement.date})`), asc(paiement.creeLe));
  return aRemettre(candidats, aujourdhui);
}

export const remiseValide = z.object({
  date: z.iso.date("Date invalide"),
  moyen: z.enum(MOYENS_REMISE),
  paiementIds: z.array(z.uuid()).min(1, "Sélectionnez au moins un paiement.").max(500),
});

export type Resultat = { ok: true; id: string } | { ok: false; message: string };

async function membreDe(tx: Tx, userId: string) {
  const [m] = await tx.select({ id: membre.id }).from(membre).where(and(eq(membre.userId, userId), eq(membre.actif, true)));
  return m?.id ?? null;
}

/** Crée une remise : chaque paiement doit être à remettre, du moyen de la remise, à la date de la remise. */
export async function creerRemise(tx: Tx, userId: string, saisie: z.input<typeof remiseValide>, aujourdhui: string): Promise<Resultat> {
  const r = remiseValide.safeParse(saisie);
  if (!r.success) return { ok: false, message: r.error.issues[0].message };
  const { date, moyen, paiementIds } = r.data;
  const ids = [...new Set(paiementIds)];
  const choisis = await lignes(tx).where(inArray(paiement.id, ids));
  const eligibles = new Set(aRemettre(choisis, date > aujourdhui ? date : aujourdhui)[moyen].map((p) => p.id));
  if (choisis.length !== ids.length || !ids.every((id) => eligibles.has(id))) {
    return { ok: false, message: "Un des paiements choisis n’est plus à remettre (déjà remis, corrigé, pas encore à encaisser ou d’un autre moyen)." };
  }
  const qui = await membreDe(tx, userId);
  if (!qui) return { ok: false, message: "Accès refusé." };
  const [{ id }] = await tx.insert(remise).values({ ecoleId: ECOLE_COURANTE, date, moyen, creePar: qui }).returning({ id: remise.id });
  await tx.insert(remisePaiement).values(ids.map((paiementId) => ({ ecoleId: ECOLE_COURANTE, remiseId: id, paiementId })));
  await tx.insert(journal).values({ ecoleId: ECOLE_COURANTE, qui, tableCible: "remise", ligneId: id, action: "insert", apres: { date, moyen, paiements: ids.length } });
  return { ok: true, id };
}

/** Annule une remise faite par erreur (direction) : ses paiements redeviennent à remettre ; trace dans le journal. */
export async function annulerRemise(tx: Tx, userId: string, id: string): Promise<Resultat> {
  if (!estUuid(id)) return { ok: false, message: "Cette remise n’existe plus." };
  const [x] = await tx.select({ date: remise.date, moyen: remise.moyen }).from(remise).where(eq(remise.id, id));
  if (!x) return { ok: false, message: "Cette remise n’existe plus." };
  const qui = await membreDe(tx, userId);
  if (!qui) return { ok: false, message: "Accès refusé." };
  await tx.delete(remise).where(eq(remise.id, id));
  await tx.insert(journal).values({ ecoleId: ECOLE_COURANTE, qui, tableCible: "remise", ligneId: id, action: "delete", avant: { date: x.date, moyen: x.moyen } });
  return { ok: true, id };
}

export type LigneRemise = { id: string; date: string; moyen: MoyenRemise; nombre: number; totalCentimes: number };

/** Remises, de la plus récente à la plus ancienne. */
export function listerRemises(tx: Tx): Promise<LigneRemise[]> {
  return tx
    .select({
      id: remise.id,
      date: remise.date,
      moyen: remise.moyen,
      nombre: sql<number>`count(${remisePaiement.paiementId})::int`,
      totalCentimes: sql<number>`coalesce(sum(${paiement.montantCentimes}), 0)::int`,
    })
    .from(remise)
    .leftJoin(remisePaiement, eq(remisePaiement.remiseId, remise.id))
    .leftJoin(paiement, eq(paiement.id, remisePaiement.paiementId))
    .groupBy(remise.id)
    .orderBy(desc(remise.date), desc(remise.creeLe));
}

/** Une remise et ses paiements (bordereau), ou null. */
export async function lireRemise(tx: Tx, id: string): Promise<(LigneRemise & { paiements: LigneJournal[] }) | null> {
  if (!estUuid(id)) return null;
  const [x] = await tx.select({ id: remise.id, date: remise.date, moyen: remise.moyen }).from(remise).where(eq(remise.id, id));
  if (!x) return null;
  const paiements = await lignes(tx).where(eq(remisePaiement.remiseId, id)).orderBy(asc(personne.nom), asc(paiement.reference));
  return { ...x, paiements, nombre: paiements.length, totalCentimes: paiements.reduce((s, p) => s + p.montantCentimes, 0) };
}
