import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type Solde, soldePayeur } from "../domaine/encaissement/solde";
import type { Tx } from "./index";
import { lessonPack, enrollment, auditLog, member, payment, person, user } from "./schema";

/**
 * Encaissements (#97) : paiements enregistrés sur le payeur, inaltérables
 * (trigger) ; une erreur se corrige par un paiement négatif lié au paiement
 * d'origine. Chaque écriture laisse une trace dans le journal. Toujours avec
 * la transaction d'`avecEcole()` (RLS).
 */

const ECOLE_COURANTE = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
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
export const dejaCorrige = sql<number>`coalesce((SELECT -sum(c.amount_cents) FROM payment c WHERE c.corrects_id = ${payment}.${sql.identifier("id")}), 0)::int`;

/** Membre de l'école courante qui saisit (pour `saisi_par` et le journal). */
async function membreDe(tx: Tx, userId: string): Promise<string | null> {
  const [m] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true)));
  return m?.id ?? null;
}

async function tracer(tx: Tx, qui: string, id: string, apres: Record<string, unknown>) {
  await tx.insert(auditLog).values({
    schoolId: ECOLE_COURANTE,
    actor: qui,
    targetTable: "payment",
    rowId: id,
    action: "insert",
    after: apres,
  });
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
  const [p] = await tx.select({ id: person.id }).from(person).where(eq(person.id, payeurId));
  if (!p) return { ok: false, message: "Payeur introuvable." };
  const qui = await membreDe(tx, userId);
  if (!qui) return { ok: false, message: "Accès refusé." };
  const ids: string[] = [];
  for (const x of r.data) {
    const [{ id }] = await tx
      .insert(payment)
      .values({
        method: x.moyen,
        amountCents: x.montantCentimes,
        date: x.date,
        reference: x.reference,
        issuer: x.emetteur,
        depositPlannedOn: x.encaissementPrevu,
        schoolId: ECOLE_COURANTE,
        payerId: payeurId,
        enteredBy: qui,
      })
      .returning({ id: payment.id });
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
      payeurId: payment.payerId,
      montant: payment.amountCents,
      moyen: payment.method,
      corrigeId: payment.correctsId,
      dejaCorrige,
    })
    .from(payment)
    .where(eq(payment.id, paiementId));
  if (!o || o.montant < 0 || o.corrigeId) return { ok: false, message: "Ce paiement ne peut pas être corrigé." };
  if (montantCentimes > o.montant - o.dejaCorrige)
    return { ok: false, message: "La correction dépasse le montant encore non corrigé." };
  const qui = await membreDe(tx, userId);
  if (!qui) return { ok: false, message: "Accès refusé." };
  const [{ id }] = await tx
    .insert(payment)
    .values({
      schoolId: ECOLE_COURANTE,
      payerId: o.payeurId,
      date,
      amountCents: -montantCentimes,
      method: o.moyen,
      reference: "Correction",
      correctsId: paiementId,
      enteredBy: qui,
    })
    .returning({ id: payment.id });
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
      id: payment.id,
      date: payment.date,
      montantCentimes: payment.amountCents,
      moyen: payment.method,
      reference: payment.reference,
      emetteur: payment.issuer,
      encaissementPrevu: payment.depositPlannedOn,
      corrigeId: payment.correctsId,
      corrigeCentimes: dejaCorrige,
      saisiPar: user.name,
    })
    .from(payment)
    .leftJoin(member, eq(member.id, payment.enteredBy))
    .leftJoin(user, eq(user.id, member.userId))
    .where(eq(payment.payerId, payeurId))
    .orderBy(desc(payment.date), desc(payment.createdAt));
}

/** Solde d'un payeur sur toutes ses inscriptions et ses carnets ; null s'il n'a jamais rien payé ni dû. */
export async function soldeDe(tx: Tx, payeurId: string, aujourdhui: string): Promise<Solde | null> {
  if (!estUuid(payeurId)) return null;
  const inscriptions = await tx
    .select({ statut: enrollment.status, prixNetCentimes: sql<number>`${enrollment.netPriceCents}::int` })
    .from(enrollment)
    .where(eq(enrollment.payerId, payeurId))
    .orderBy(asc(enrollment.createdAt));
  const carnets = await tx
    .select({ prixCentimes: lessonPack.priceCents })
    .from(lessonPack)
    .where(eq(lessonPack.payerId, payeurId));
  const reglements = await tx
    .select({ montantCentimes: payment.amountCents, encaissementPrevu: payment.depositPlannedOn })
    .from(payment)
    .where(eq(payment.payerId, payeurId));
  if (inscriptions.length === 0 && carnets.length === 0 && reglements.length === 0) return null;
  return soldePayeur(inscriptions, carnets, reglements, aujourdhui);
}
