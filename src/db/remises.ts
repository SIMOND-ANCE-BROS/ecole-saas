import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { aRemettre, MOYENS_REMISE, type MoyenRemise } from "../domaine/encaissement/remises";
import type { Tx } from "./index";
import { dejaCorrige, type Moyen } from "./paiements";
import { auditLog, member, payment, person, bankDeposit, bankDepositPayment } from "./schema";

/**
 * Journal des encaissements et remises en banque (#98). Une remise relie des
 * paiements par une table à part : le paiement, inaltérable, n'est jamais
 * modifié. Toujours avec la transaction d'`avecEcole()` (RLS).
 */

const ECOLE_COURANTE = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const estUuid = (v: string) => z.uuid().safeParse(v).success;
const nomPayeur = sql<string>`coalesce(${person.companyName}, concat_ws(' ', ${person.firstName}, ${person.lastName}))`;

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
      id: payment.id,
      date: payment.date,
      payeurId: payment.payerId,
      payeur: nomPayeur,
      moyen: payment.method,
      montantCentimes: payment.amountCents,
      corrigeCentimes: dejaCorrige,
      reference: payment.reference,
      emetteur: payment.issuer,
      encaissementPrevu: payment.depositPlannedOn,
      remiseId: bankDepositPayment.bankDepositId,
      remiseDate: bankDeposit.date,
    })
    .from(payment)
    .innerJoin(person, eq(person.id, payment.payerId))
    .leftJoin(bankDepositPayment, eq(bankDepositPayment.paymentId, payment.id))
    .leftJoin(bankDeposit, eq(bankDeposit.id, bankDepositPayment.bankDepositId));
}

/** Paiements reçus entre deux dates (incluses), éventuellement d'un seul moyen, du plus ancien au plus récent. */
export async function journalEncaissements(
  tx: Tx,
  du: string,
  au: string,
  moyen: Moyen | null,
): Promise<LigneJournal[]> {
  return lignes(tx)
    .where(and(sql`${payment.date} BETWEEN ${du}::date AND ${au}::date`, moyen ? eq(payment.method, moyen) : undefined))
    .orderBy(asc(payment.date), asc(payment.createdAt));
}

/** Chèques arrivés à échéance, espèces et chèques vacances pas encore remis, par moyen. */
export async function paiementsARemettre(tx: Tx, aujourdhui: string): Promise<Record<MoyenRemise, LigneJournal[]>> {
  const candidats = await lignes(tx)
    .where(
      and(
        inArray(payment.method, [...MOYENS_REMISE]),
        sql`${payment.amountCents} > 0`,
        sql`${bankDepositPayment.bankDepositId} IS NULL`,
      ),
    )
    .orderBy(asc(sql`coalesce(${payment.depositPlannedOn}, ${payment.date})`), asc(payment.createdAt));
  return aRemettre(candidats, aujourdhui);
}

export const remiseValide = z.object({
  date: z.iso.date("Date invalide"),
  moyen: z.enum(MOYENS_REMISE),
  paiementIds: z.array(z.uuid()).min(1, "Sélectionnez au moins un paiement.").max(500),
});

export type Resultat = { ok: true; id: string } | { ok: false; message: string };

async function membreDe(tx: Tx, userId: string) {
  const [m] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true)));
  return m?.id ?? null;
}

/** Crée une remise : chaque paiement doit être à remettre, du moyen de la remise, à la date de la remise. */
export async function creerRemise(
  tx: Tx,
  userId: string,
  saisie: z.input<typeof remiseValide>,
  aujourdhui: string,
): Promise<Resultat> {
  const r = remiseValide.safeParse(saisie);
  if (!r.success) return { ok: false, message: r.error.issues[0].message };
  const { date, moyen, paiementIds } = r.data;
  const ids = [...new Set(paiementIds)];
  const choisis = await lignes(tx).where(inArray(payment.id, ids));
  const eligibles = new Set(aRemettre(choisis, date > aujourdhui ? date : aujourdhui)[moyen].map((p) => p.id));
  if (choisis.length !== ids.length || !ids.every((id) => eligibles.has(id))) {
    return {
      ok: false,
      message:
        "Un des paiements choisis n’est plus à remettre (déjà remis, corrigé, pas encore à encaisser ou d’un autre moyen).",
    };
  }
  const qui = await membreDe(tx, userId);
  if (!qui) return { ok: false, message: "Accès refusé." };
  const [{ id }] = await tx
    .insert(bankDeposit)
    .values({ schoolId: ECOLE_COURANTE, date, method: moyen, createdBy: qui })
    .returning({ id: bankDeposit.id });
  await tx
    .insert(bankDepositPayment)
    .values(ids.map((paiementId) => ({ schoolId: ECOLE_COURANTE, bankDepositId: id, paymentId: paiementId })));
  await tx.insert(auditLog).values({
    schoolId: ECOLE_COURANTE,
    actor: qui,
    targetTable: "bank_deposit",
    rowId: id,
    action: "insert",
    after: { date, moyen, paiements: ids.length },
  });
  return { ok: true, id };
}

/** Annule une remise faite par erreur (direction) : ses paiements redeviennent à remettre ; trace dans le journal. */
export async function annulerRemise(tx: Tx, userId: string, id: string): Promise<Resultat> {
  if (!estUuid(id)) return { ok: false, message: "Cette remise n’existe plus." };
  const [x] = await tx
    .select({ date: bankDeposit.date, moyen: bankDeposit.method })
    .from(bankDeposit)
    .where(eq(bankDeposit.id, id));
  if (!x) return { ok: false, message: "Cette remise n’existe plus." };
  const qui = await membreDe(tx, userId);
  if (!qui) return { ok: false, message: "Accès refusé." };
  await tx.delete(bankDeposit).where(eq(bankDeposit.id, id));
  await tx.insert(auditLog).values({
    schoolId: ECOLE_COURANTE,
    actor: qui,
    targetTable: "bank_deposit",
    rowId: id,
    action: "delete",
    before: { date: x.date, moyen: x.moyen },
  });
  return { ok: true, id };
}

export type LigneRemise = { id: string; date: string; moyen: MoyenRemise; nombre: number; totalCentimes: number };

/** Remises, de la plus récente à la plus ancienne. */
export function listerRemises(tx: Tx): Promise<LigneRemise[]> {
  return tx
    .select({
      id: bankDeposit.id,
      date: bankDeposit.date,
      moyen: bankDeposit.method,
      nombre: sql<number>`count(${bankDepositPayment.paymentId})::int`,
      totalCentimes: sql<number>`coalesce(sum(${payment.amountCents}), 0)::int`,
    })
    .from(bankDeposit)
    .leftJoin(bankDepositPayment, eq(bankDepositPayment.bankDepositId, bankDeposit.id))
    .leftJoin(payment, eq(payment.id, bankDepositPayment.paymentId))
    .groupBy(bankDeposit.id)
    .orderBy(desc(bankDeposit.date), desc(bankDeposit.createdAt));
}

/** Une remise et ses paiements (bordereau), ou null. */
export async function lireRemise(tx: Tx, id: string): Promise<(LigneRemise & { paiements: LigneJournal[] }) | null> {
  if (!estUuid(id)) return null;
  const [x] = await tx
    .select({ id: bankDeposit.id, date: bankDeposit.date, moyen: bankDeposit.method })
    .from(bankDeposit)
    .where(eq(bankDeposit.id, id));
  if (!x) return null;
  const paiements = await lignes(tx)
    .where(eq(bankDepositPayment.bankDepositId, id))
    .orderBy(asc(person.lastName), asc(payment.reference));
  return {
    ...x,
    paiements,
    nombre: paiements.length,
    totalCentimes: paiements.reduce((s, p) => s + p.montantCentimes, 0),
  };
}
