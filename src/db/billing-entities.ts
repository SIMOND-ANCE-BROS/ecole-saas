import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { columnsOf } from "./columns-of";
import type { Tx } from "./index";
import { VAT_REGIMES } from "./instructors";
import { auditLog, billingEntity, member } from "./schema";
import {
  changedFields,
  compact,
  isSiren,
  isSiret,
  isVatNumber,
  looksLikeIban,
  sirenOf,
  siretMatchesSiren,
} from "../domain/billing/entity";
import { issuePath } from "../lib/form-errors";

/**
 * Billing entities of a school (#298, ADR 0006): the businesses that invoice,
 * cash and deposit. Exactly one is the default; with a single entity, nothing
 * else in the interface shows them. Always within `withSchool()` (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;
export type Result = { ok: true; id: string } | { ok: false; message: string };

const GONE = "Cette entreprise n’existe plus.";
const TAKEN = "Une autre entreprise porte déjà ce nom.";

type Regime = keyof typeof VAT_REGIMES;
const REGIMES = Object.keys(VAT_REGIMES) as [Regime, ...Regime[]];

/** Optional text: trimmed, empty becomes null. */
const optional = (max: number, message: string) =>
  z
    .string({ error: "Saisie invalide." })
    .trim()
    .max(max, message)
    .transform((v) => v || null);

/** Optional identifier: spaces and dots removed, empty becomes null, then checked. */
const identifier = (valid: (s: string) => boolean, message: string, upper = false) =>
  z
    .string({ error: "Saisie invalide." })
    .transform((v) => (upper ? compact(v).toUpperCase() : compact(v)) || null)
    .refine((v) => v === null || valid(v), message);

const entityFields = z.object(
  {
    name: z
      .string({ error: "Nom obligatoire" })
      .trim()
      .min(1, "Nom obligatoire")
      .max(80, "Nom : 80 caractères au plus"),
    legalName: z
      .string({ error: "Raison sociale obligatoire" })
      .trim()
      .min(1, "Raison sociale obligatoire")
      .max(200, "Raison sociale : 200 caractères au plus"),
    siren: identifier(isSiren, "SIREN : 9 chiffres"),
    siret: identifier(isSiret, "SIRET : 14 chiffres"),
    vatNumber: identifier(
      isVatNumber,
      "Numéro de TVA : deux lettres puis des chiffres (FR suivi de 11 caractères)",
      true,
    ),
    addressLine: optional(200, "Adresse : 200 caractères au plus"),
    postalCode: identifier((s) => /^\d{5}$/.test(s), "Code postal : 5 chiffres"),
    city: optional(100, "Ville : 100 caractères au plus"),
    vatRegime: z.enum(REGIMES, { error: "Régime de TVA à choisir" }),
    vatMention: optional(300, "Mention : 300 caractères au plus"),
    bankAccountLabel: optional(100, "Compte bancaire : 100 caractères au plus"),
  },
  { error: "Saisie invalide." },
);

export const validEntityInput = entityFields
  .refine((e) => siretMatchesSiren(e.siret, e.siren), {
    path: issuePath(entityFields, "siret"),
    message: "Ce SIRET n’est pas celui de ce SIREN (ses 9 premiers chiffres diffèrent).",
  })
  .refine((e) => e.bankAccountLabel === null || !looksLikeIban(e.bankAccountLabel), {
    path: issuePath(entityFields, "bankAccountLabel"),
    message: "N’indiquez pas l’IBAN ici : un nom de compte suffit (il sera imprimé sur les bordereaux).",
  });
export type EntityInput = z.input<typeof validEntityInput>;

/** Entity columns from the form input; a SIRET alone also gives the SIREN. */
const entityRow = (e: z.output<typeof validEntityInput>) => ({
  name: e.name,
  legalName: e.legalName,
  siren: sirenOf(e.siren, e.siret),
  siret: e.siret,
  vatNumber: e.vatNumber,
  addressLine: e.addressLine,
  postalCode: e.postalCode,
  city: e.city,
  vatRegime: e.vatRegime,
  vatMention: e.vatMention,
  bankAccountLabel: e.bankAccountLabel,
});

export type EntityRow = {
  id: string;
  name: string;
  legalName: string;
  siren: string | null;
  siret: string | null;
  vatNumber: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  vatRegime: Regime;
  vatMention: string | null;
  bankAccountLabel: string | null;
  isDefault: boolean;
};

/** The school's entities, the default first, then by name. */
export function listEntities(tx: Tx): Promise<EntityRow[]> {
  return tx
    .select({
      id: billingEntity.id,
      name: billingEntity.name,
      legalName: billingEntity.legalName,
      siren: billingEntity.siren,
      siret: billingEntity.siret,
      vatNumber: billingEntity.vatNumber,
      addressLine: billingEntity.addressLine,
      postalCode: billingEntity.postalCode,
      city: billingEntity.city,
      vatRegime: billingEntity.vatRegime,
      vatMention: billingEntity.vatMention,
      bankAccountLabel: billingEntity.bankAccountLabel,
      isDefault: billingEntity.isDefault,
    })
    .from(billingEntity)
    .orderBy(desc(billingEntity.isDefault), asc(billingEntity.name));
}

/**
 * The school's default entity: until each course carries its own (#299), every
 * payment and deposit is recorded for it. Null for a school set up without one.
 */
export async function defaultEntityId(tx: Tx): Promise<string | null> {
  const [e] = await tx.select({ id: billingEntity.id }).from(billingEntity).where(eq(billingEntity.isDefault, true));
  return e?.id ?? null;
}

/** Shown when a school has no default entity: nothing can be cashed until it has one. */
export const NO_DEFAULT_ENTITY =
  "Aucune entreprise par défaut : la direction la choisit dans Paramètres › Entreprises.";

async function nameTaken(tx: Tx, name: string, except?: string): Promise<boolean> {
  const [x] = await tx
    .select({ id: billingEntity.id })
    .from(billingEntity)
    .where(and(sql`lower(${billingEntity.name}) = lower(${name})`, except ? ne(billingEntity.id, except) : undefined))
    .limit(1);
  return x !== undefined;
}

/** Active member of the current school who makes the change (the audit log's actor). */
async function memberOf(tx: Tx, userId: string): Promise<string | null> {
  const [m] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true)));
  return m?.id ?? null;
}

/**
 * Audit log of an entity change (#298): its legal identity and VAT data end up
 * on invoices. Technical ids and field names only, never the values typed (a
 * sole trader's SIREN and address are personal data).
 */
async function log(
  tx: Tx,
  actor: string,
  id: string,
  action: "insert" | "update",
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
) {
  await tx
    .insert(auditLog)
    .values({ schoolId: CURRENT_SCHOOL, actor, targetTable: "billing_entity", rowId: id, action, before, after });
}

/** A new entity; the school's first one becomes its default. */
export async function createEntity(tx: Tx, userId: string, entry: EntityInput): Promise<Result> {
  const e = validEntityInput.safeParse(entry);
  if (!e.success) return { ok: false, message: e.error.issues[0].message };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  // The school's entities locked, as makeDefaultEntity does: two entities added at the same
  // moment wait for each other, so the second sees the first's name and default.
  await tx.select({ id: billingEntity.id }).from(billingEntity).orderBy(asc(billingEntity.id)).for("update");
  if (await nameTaken(tx, e.data.name)) return { ok: false, message: TAKEN };
  const first = (await defaultEntityId(tx)) === null;
  const row = entityRow(e.data);
  const [{ id }] = await tx
    .insert(billingEntity)
    .values(columnsOf(billingEntity, { ...row, schoolId: CURRENT_SCHOOL, isDefault: first }))
    .returning({ id: billingEntity.id });
  const filled = (Object.keys(row) as (keyof typeof row)[]).filter((k) => row[k] !== null);
  await log(tx, who, id, "insert", null, { fields: filled, is_default: first });
  return { ok: true, id };
}

export async function updateEntity(tx: Tx, userId: string, id: string, entry: EntityInput): Promise<Result> {
  const e = validEntityInput.safeParse(entry);
  if (!e.success) return { ok: false, message: e.error.issues[0].message };
  if (!isUuid(id)) return { ok: false, message: GONE };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  if (await nameTaken(tx, e.data.name, id)) return { ok: false, message: TAKEN };
  const [before] = await tx
    .select({
      name: billingEntity.name,
      legalName: billingEntity.legalName,
      siren: billingEntity.siren,
      siret: billingEntity.siret,
      vatNumber: billingEntity.vatNumber,
      addressLine: billingEntity.addressLine,
      postalCode: billingEntity.postalCode,
      city: billingEntity.city,
      vatRegime: billingEntity.vatRegime,
      vatMention: billingEntity.vatMention,
      bankAccountLabel: billingEntity.bankAccountLabel,
    })
    .from(billingEntity)
    .where(eq(billingEntity.id, id))
    .for("update");
  if (!before) return { ok: false, message: GONE };
  const row = entityRow(e.data);
  const fields = changedFields(before, row);
  if (fields.length === 0) return { ok: true, id };
  await tx.update(billingEntity).set(columnsOf(billingEntity, row)).where(eq(billingEntity.id, id));
  await log(tx, who, id, "update", null, { fields });
  return { ok: true, id };
}

/**
 * Makes an entity the school's default, in place of the previous one. Two
 * statements: the partial unique index (one default per school) is checked row
 * by row, so the old default is cleared before the new one is set.
 */
export async function makeDefaultEntity(tx: Tx, userId: string, id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: GONE };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  // Every entity of the school, locked: two changes of default made at the same moment
  // wait for each other instead of both clearing the old default and failing on the index.
  const all = await tx
    .select({ id: billingEntity.id })
    .from(billingEntity)
    .orderBy(asc(billingEntity.id))
    .for("update");
  if (!all.some((e) => e.id === id)) return { ok: false, message: GONE };
  const previous = await defaultEntityId(tx);
  if (previous === id) return { ok: true, id };
  await tx
    .update(billingEntity)
    .set({ isDefault: false })
    .where(and(eq(billingEntity.isDefault, true), ne(billingEntity.id, id)));
  await tx.update(billingEntity).set({ isDefault: true, active: true }).where(eq(billingEntity.id, id));
  await log(tx, who, id, "update", { default_entity_id: previous }, { default_entity_id: id });
  return { ok: true, id };
}
