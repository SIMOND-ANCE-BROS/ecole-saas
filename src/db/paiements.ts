import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type Solde, soldePayeur } from "../domaine/encaissement/solde";
import type { Tx } from "./index";
import { carnet, inscription, journal, membre, paiement, personne, user } from "./schema";

/**
 * Encaissements (#97) : paiements enregistrés sur le payeur, inaltérables
 * (trigger) ; une erreur se corrige par un paiement négatif lié au paiement
 * d'origine. Chaque écriture laisse une trace dans le journal. Toujours avec
 * la transaction d'`avecEcole()` (RLS).
 */

const ECOLE_COURANTE = sql`nullif(current_setting('app.ecole_id', true), '')::uuid`;
const estUuid = (v: string) => z.uuid().safeParse(v).success;

export const MOYENS = {
  cheque: "Chèque",
  especes: "Espèces",
  carte: "Carte",
  virement: "Virement",
  prelevement: "Prélèvement",
  cheque_vacances: "Chèques vacances",
  pass_sport: "Pass’Sport",
  autre: "Autre",
} as const;
export type Moyen = keyof typeof MOYENS;

const texteCourt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

export const reglementValide = z
  .object({
    moyen: z.enum(Object.keys(MOYENS) as [Moyen, ...Moyen[]]),
    montantCentimes: z.int("Montant invalide").min(1, "Montant invalide").max(10_000_00, "Montant trop élevé"),
    date: z.iso.date("Date invalide"),
    reference: texteCourt(60),
    emetteur: texteCourt(100),
    encaissementPrevu: z.iso.date("Date invalide").nullable(),
  })
  .refine((r) => r.encaissementPrevu === null || r.moyen === "cheque", {
    path: ["encaissementPrevu"],
    message: "Seul un chèque s’encaisse plus tard",
  })
  .refine((r) => r.encaissementPrevu === null || r.encaissementPrevu >= r.date, {
    path: ["encaissementPrevu"],
    message: "L’encaissement suit la réception",
  });
export const reglementsValides = z.array(reglementValide).min(1, "Aucun règlement").max(24);

export type Resultat = { ok: true; ids: string[] } | { ok: false; message: string };

/**
 * Montant déjà annulé par des corrections. Identifiant écrit avec le nom de
 * table : dans un `select`, Drizzle l'écrirait seul, et il désignerait alors
 * la ligne de la sous-requête.
 */
export const dejaCorrige = sql<number>`coalesce((SELECT -sum(c.montant_centimes) FROM paiement c WHERE c.corrige_id = ${paiement}.${sql.identifier("id")}), 0)::int`;

/** Membre de l'école courante qui saisit (pour `saisi_par` et le journal). */
async function membreDe(tx: Tx, userId: string): Promise<string | null> {
  const [m] = await tx
    .select({ id: membre.id })
    .from(membre)
    .where(and(eq(membre.userId, userId), eq(membre.actif, true)));
  return m?.id ?? null;
}

async function tracer(tx: Tx, qui: string, id: string, apres: Record<string, unknown>) {
  await tx
    .insert(journal)
    .values({ ecoleId: ECOLE_COURANTE, qui, tableCible: "paiement", ligneId: id, action: "insert", apres });
}

/** Enregistre un ou plusieurs règlements d'un payeur (trois chèques datés, chèque + espèces…). */
export async function encaisser(
  tx: Tx,
  userId: string,
  payeurId: string,
  saisie: z.input<typeof reglementsValides>,
): Promise<Resultat> {
  const r = reglementsValides.safeParse(saisie);
  if (!r.success) return { ok: false, message: r.error.issues[0].message };
  if (!estUuid(payeurId)) return { ok: false, message: "Payeur introuvable." };
  const [p] = await tx.select({ id: personne.id }).from(personne).where(eq(personne.id, payeurId));
  if (!p) return { ok: false, message: "Payeur introuvable." };
  const qui = await membreDe(tx, userId);
  if (!qui) return { ok: false, message: "Accès refusé." };
  const ids: string[] = [];
  for (const x of r.data) {
    const [{ id }] = await tx
      .insert(paiement)
      .values({ ...x, ecoleId: ECOLE_COURANTE, payeurId, saisiPar: qui })
      .returning({ id: paiement.id });
    await tracer(tx, qui, id, {
      montant_centimes: x.montantCentimes,
      moyen: x.moyen,
      date: x.date,
      encaissement_prevu: x.encaissementPrevu,
    });
    ids.push(id);
  }
  return { ok: true, ids };
}

/**
 * Annule tout ou partie d'un paiement (direction) : paiement négatif du même
 * moyen, lié à l'original, dans la limite de ce qui n'est pas déjà corrigé.
 */
export async function corrigerPaiement(
  tx: Tx,
  userId: string,
  paiementId: string,
  montantCentimes: number,
  date: string,
): Promise<Resultat> {
  if (!estUuid(paiementId)) return { ok: false, message: "Ce paiement n’existe plus." };
  if (!Number.isInteger(montantCentimes) || montantCentimes <= 0) return { ok: false, message: "Montant invalide" };
  if (!z.iso.date().safeParse(date).success) return { ok: false, message: "Date invalide" };
  const [o] = await tx
    .select({
      payeurId: paiement.payeurId,
      montant: paiement.montantCentimes,
      moyen: paiement.moyen,
      corrigeId: paiement.corrigeId,
      dejaCorrige,
    })
    .from(paiement)
    .where(eq(paiement.id, paiementId));
  if (!o || o.montant < 0 || o.corrigeId) return { ok: false, message: "Ce paiement ne peut pas être corrigé." };
  if (montantCentimes > o.montant - o.dejaCorrige)
    return { ok: false, message: "La correction dépasse le montant encore non corrigé." };
  const qui = await membreDe(tx, userId);
  if (!qui) return { ok: false, message: "Accès refusé." };
  const [{ id }] = await tx
    .insert(paiement)
    .values({
      ecoleId: ECOLE_COURANTE,
      payeurId: o.payeurId,
      date,
      montantCentimes: -montantCentimes,
      moyen: o.moyen,
      reference: "Correction",
      corrigeId: paiementId,
      saisiPar: qui,
    })
    .returning({ id: paiement.id });
  await tracer(tx, qui, id, { montant_centimes: -montantCentimes, moyen: o.moyen, date, corrige_id: paiementId });
  return { ok: true, ids: [id] };
}

export type LignePaiement = {
  id: string;
  date: string;
  montantCentimes: number;
  moyen: Moyen;
  reference: string | null;
  emetteur: string | null;
  encaissementPrevu: string | null;
  corrigeId: string | null;
  /** Montant déjà annulé par des corrections (paiements positifs). */
  corrigeCentimes: number;
  saisiPar: string | null;
};

/** Paiements d'un payeur, du plus récent au plus ancien. */
export async function paiementsDe(tx: Tx, payeurId: string): Promise<LignePaiement[]> {
  if (!estUuid(payeurId)) return [];
  return tx
    .select({
      id: paiement.id,
      date: paiement.date,
      montantCentimes: paiement.montantCentimes,
      moyen: paiement.moyen,
      reference: paiement.reference,
      emetteur: paiement.emetteur,
      encaissementPrevu: paiement.encaissementPrevu,
      corrigeId: paiement.corrigeId,
      corrigeCentimes: dejaCorrige,
      saisiPar: user.name,
    })
    .from(paiement)
    .leftJoin(membre, eq(membre.id, paiement.saisiPar))
    .leftJoin(user, eq(user.id, membre.userId))
    .where(eq(paiement.payeurId, payeurId))
    .orderBy(desc(paiement.date), desc(paiement.creeLe));
}

/** Solde d'un payeur sur toutes ses inscriptions et ses carnets ; null s'il n'a jamais rien payé ni dû. */
export async function soldeDe(tx: Tx, payeurId: string, aujourdhui: string): Promise<Solde | null> {
  if (!estUuid(payeurId)) return null;
  const inscriptions = await tx
    .select({ statut: inscription.statut, prixNetCentimes: sql<number>`${inscription.prixNetCentimes}::int` })
    .from(inscription)
    .where(eq(inscription.payeurId, payeurId))
    .orderBy(asc(inscription.creeLe));
  const carnets = await tx
    .select({ prixCentimes: carnet.prixCentimes })
    .from(carnet)
    .where(eq(carnet.payeurId, payeurId));
  const reglements = await tx
    .select({ montantCentimes: paiement.montantCentimes, encaissementPrevu: paiement.encaissementPrevu })
    .from(paiement)
    .where(eq(paiement.payeurId, payeurId));
  if (inscriptions.length === 0 && carnets.length === 0 && reglements.length === 0) return null;
  return soldePayeur(inscriptions, carnets, reglements, aujourdhui);
}
