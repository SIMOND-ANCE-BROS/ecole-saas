import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { columnsOf } from "./columns-of";
import type { Tx } from "./index";
import { auditLog, billingEntity, course, invoiceLine, lessonPack, member, season, vatTreatment } from "./schema";
import {
  NO_VAT_CHARGED,
  parseRate,
  treatmentRefusal,
  treatmentShapeRefusal,
  VAT_CATEGORIES,
  type VatCategory,
  type VatRegime,
} from "../domain/billing/vat";
import { changedFields } from "../domain/billing/entity";
import { issuePath } from "../lib/form-errors";

/**
 * VAT treatments of a school (#301, ADR 0006): how VAT applies to a course or a
 * lesson pack. Labels and mentions are the school's data (worded with its
 * accountant), never code. Always within `withSchool()` (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: unknown): v is string => z.uuid().safeParse(v).success;
export type Result = { ok: true; id: string } | { ok: false; message: string };

const GONE = "Ce traitement de TVA n’existe plus.";
const TAKEN = "Un autre traitement de TVA porte déjà ce nom.";

const treatmentFields = z.object(
  {
    label: z
      .string({ error: "Nom obligatoire" })
      .trim()
      .min(1, "Nom obligatoire")
      .max(80, "Nom : 80 caractères au plus"),
    category: z.enum(VAT_CATEGORIES, { error: "Type de traitement à choisir" }),
    /** Typed in percent (« 20 », « 5,5 »); ignored unless the category has a rate. */
    rate: z.string({ error: "Saisie invalide." }).max(20, "Taux en pourcentage, par exemple 20 ou 5,5"),
    mention: z
      .string({ error: "Saisie invalide." })
      .trim()
      .max(300, "Mention : 300 caractères au plus")
      .transform((v) => v || null),
  },
  { error: "Saisie invalide." },
);

export const validTreatmentInput = treatmentFields
  .refine((t) => t.category !== "standard" || parseRate(t.rate) !== null, {
    path: issuePath(treatmentFields, "rate"),
    message: "Taux en pourcentage, par exemple 20 ou 5,5",
  })
  .transform((t) => ({
    label: t.label,
    category: t.category,
    rateBps: t.category === "standard" ? (parseRate(t.rate) ?? 0) : 0,
    // A treatment with a rate prints no mention on its lines.
    mention: t.category === "standard" ? null : t.mention,
  }))
  .superRefine((t, ctx) => {
    const message = treatmentShapeRefusal(t);
    if (message)
      ctx.addIssue({
        code: "custom",
        message,
        path: issuePath(treatmentFields, t.category === "standard" ? "rate" : "mention"),
      });
  });
export type TreatmentInput = z.input<typeof validTreatmentInput>;

export type TreatmentRow = {
  id: string;
  label: string;
  category: VatCategory;
  rateBps: number;
  mention: string | null;
  /** Courses, lesson packs and invoice lines that carry it: a used treatment cannot be removed. */
  uses: number;
};

/** The school's treatments, by name, with how many rows use them. */
export async function listTreatments(tx: Tx): Promise<TreatmentRow[]> {
  const rows = await tx
    .select({
      id: vatTreatment.id,
      label: vatTreatment.label,
      category: vatTreatment.category,
      rateBps: vatTreatment.rateBps,
      mention: vatTreatment.mention,
      uses: sql<number>`(
        (SELECT count(*) FROM course c WHERE c.vat_treatment_id = "vat_treatment"."id")
        + (SELECT count(*) FROM lesson_pack p WHERE p.vat_treatment_id = "vat_treatment"."id")
        + (SELECT count(*) FROM invoice_line l WHERE l.vat_treatment_id = "vat_treatment"."id"))::int`,
    })
    .from(vatTreatment)
    .orderBy(asc(vatTreatment.label));
  return rows;
}

/** A treatment offered in a choice (course form, business form). */
export type TreatmentChoice = { id: string; label: string; category: VatCategory };

export function treatmentChoices(tx: Tx): Promise<TreatmentChoice[]> {
  return tx
    .select({ id: vatTreatment.id, label: vatTreatment.label, category: vatTreatment.category })
    .from(vatTreatment)
    .orderBy(asc(vatTreatment.label));
}

/**
 * Treatment of each instructor's last course (latest season, then latest created): the
 * course form proposes it for their new course (#301, UI help only).
 */
export async function lastTreatmentByInstructor(tx: Tx): Promise<Record<string, string>> {
  const rows = await tx
    .selectDistinctOn([course.instructorId], { instructorId: course.instructorId, id: course.vatTreatmentId })
    .from(course)
    .innerJoin(season, eq(season.id, course.seasonId))
    .orderBy(course.instructorId, sql`${season.startDate} DESC`, sql`${course.createdAt} DESC`, course.id);
  return Object.fromEntries(rows.map((r) => [r.instructorId, r.id]));
}

/** Business regimes and default treatments, for the course form to filter and preselect. */
export async function entityVat(
  tx: Tx,
): Promise<Record<string, { regime: VatRegime; defaultTreatment: string | null }>> {
  const rows = await tx
    .select({
      id: billingEntity.id,
      regime: billingEntity.vatRegime,
      defaultTreatment: billingEntity.defaultVatTreatmentId,
    })
    .from(billingEntity);
  return Object.fromEntries(rows.map((r) => [r.id, { regime: r.regime, defaultTreatment: r.defaultTreatment }]));
}

/** What the course form needs to offer and propose a treatment (#301). */
export type CourseVat = {
  treatments: TreatmentChoice[];
  entities: Awaited<ReturnType<typeof entityVat>>;
  lastByInstructor: Record<string, string>;
};

export async function courseVat(tx: Tx): Promise<CourseVat> {
  return {
    treatments: await treatmentChoices(tx),
    entities: await entityVat(tx),
    lastByInstructor: await lastTreatmentByInstructor(tx),
  };
}

/** Said when a business has no default treatment and none was chosen. */
export const NO_DEFAULT_TREATMENT =
  "Cette entreprise n’a pas de traitement de TVA par défaut : la direction le choisit dans Paramètres › Entreprises.";

/**
 * The treatment a course or lesson pack of `entityId` gets (#301): the one chosen, else the
 * row's own (`current`), else the business's default; refused when the business's regime
 * cannot use it (a VAT rate under the franchise).
 */
export async function resolveTreatment(
  tx: Tx,
  p: { wanted: string | undefined; entityId: string; current?: string },
): Promise<Result> {
  // Shared lock: its regime cannot change to one without VAT before the commit (see regimeRefusal).
  const [entity] = await tx
    .select({ regime: billingEntity.vatRegime, defaultTreatment: billingEntity.defaultVatTreatmentId })
    .from(billingEntity)
    .where(eq(billingEntity.id, p.entityId))
    .for("share");
  if (!entity) return { ok: false, message: "Entreprise introuvable." };
  const id = p.wanted ?? p.current ?? entity.defaultTreatment;
  if (!id) return { ok: false, message: NO_DEFAULT_TREATMENT };
  if (!isUuid(id)) return { ok: false, message: GONE };
  // Shared lock: the treatment cannot turn into a rate the business refuses before the commit.
  const [t] = await tx
    .select({ id: vatTreatment.id, category: vatTreatment.category })
    .from(vatTreatment)
    .where(eq(vatTreatment.id, id))
    .for("share");
  if (!t) return { ok: false, message: GONE };
  const refused = treatmentRefusal(entity.regime, t.category);
  return refused ? { ok: false, message: refused } : { ok: true, id: t.id };
}

/** Said when a business could have a default treatment but none was chosen. */
export const DEFAULT_TREATMENT_REQUIRED =
  "Choisissez le traitement de TVA par défaut : il est donné aux carnets vendus par cette entreprise.";

/**
 * Why a business of `regime` cannot keep its treatments (#301): its default one is missing
 * while the school has one it could use (its lesson packs need it), is gone, or has a VAT
 * rate its regime refuses; or one of its courses or lesson packs has such a rate. Null
 * when it can. The business row is locked by the caller; the treatments read are locked
 * FOR SHARE, so a treatment cannot turn into a rate meanwhile (see updateTreatment).
 */
export async function regimeRefusal(
  tx: Tx,
  p: { entityId: string | null; regime: VatRegime; defaultTreatment: string | null },
): Promise<string | null> {
  const usable = (
    await tx
      .select({ id: vatTreatment.id, category: vatTreatment.category })
      .from(vatTreatment)
      .orderBy(asc(vatTreatment.id))
      .for("share")
  ).filter((t) => treatmentRefusal(p.regime, t.category) === null);
  if (p.defaultTreatment) {
    const [d] = await tx
      .select({ category: vatTreatment.category })
      .from(vatTreatment)
      .where(eq(vatTreatment.id, p.defaultTreatment));
    if (!d) return GONE;
    const refused = treatmentRefusal(p.regime, d.category);
    if (refused) return `Traitement de TVA par défaut : ${refused}`;
  } else if (usable.length > 0) return DEFAULT_TREATMENT_REQUIRED;
  if (treatmentRefusal(p.regime, "standard") === null || !p.entityId) return null;
  const standard = tx.select({ id: vatTreatment.id }).from(vatTreatment).where(eq(vatTreatment.category, "standard"));
  const [courses] = await tx
    .select({ n: count() })
    .from(course)
    .where(and(eq(course.billingEntityId, p.entityId), inArray(course.vatTreatmentId, standard)));
  const [packs] = await tx
    .select({ n: count() })
    .from(lessonPack)
    .where(and(eq(lessonPack.billingEntityId, p.entityId), inArray(lessonPack.vatTreatmentId, standard)));
  return courses.n + packs.n > 0
    ? "Des cours ou des carnets de cette entreprise ont un traitement avec TVA : changez-les avant de passer à un régime sans TVA."
    : null;
}

async function labelTaken(tx: Tx, label: string, except?: string): Promise<boolean> {
  const [x] = await tx
    .select({ id: vatTreatment.id })
    .from(vatTreatment)
    .where(and(sql`lower(${vatTreatment.label}) = lower(${label})`, except ? ne(vatTreatment.id, except) : undefined))
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

/** Audit log of a treatment change: what ends up on invoices. Field names, as for businesses. */
async function log(tx: Tx, actor: string, id: string, action: "insert" | "update" | "delete", after: object | null) {
  await tx
    .insert(auditLog)
    .values({ schoolId: CURRENT_SCHOOL, actor, targetTable: "vat_treatment", rowId: id, action, after });
}

export async function createTreatment(tx: Tx, userId: string, entry: TreatmentInput): Promise<Result> {
  const t = validTreatmentInput.safeParse(entry);
  if (!t.success) return { ok: false, message: t.error.issues[0].message };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  if (await labelTaken(tx, t.data.label)) return { ok: false, message: TAKEN };
  const [{ id }] = await tx
    .insert(vatTreatment)
    .values(columnsOf(vatTreatment, { ...t.data, schoolId: CURRENT_SCHOOL }))
    .returning({ id: vatTreatment.id });
  await log(tx, who, id, "insert", { ...t.data });
  return { ok: true, id };
}

/**
 * Changes a treatment. Invoice lines already drafted keep their copy (#301); a VAT rate is
 * refused while a business that charges no VAT uses the treatment (default, course, pack).
 */
export async function updateTreatment(tx: Tx, userId: string, id: string, entry: TreatmentInput): Promise<Result> {
  const t = validTreatmentInput.safeParse(entry);
  if (!t.success) return { ok: false, message: t.error.issues[0].message };
  if (!isUuid(id)) return { ok: false, message: GONE };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  if (await labelTaken(tx, t.data.label, id)) return { ok: false, message: TAKEN };
  const [before] = await tx
    .select({
      label: vatTreatment.label,
      category: vatTreatment.category,
      rateBps: vatTreatment.rateBps,
      mention: vatTreatment.mention,
    })
    .from(vatTreatment)
    .where(eq(vatTreatment.id, id))
    .for("update");
  if (!before) return { ok: false, message: GONE };
  if (t.data.category === "standard" && before.category !== "standard") {
    // Every business locked first: none switches to a regime without VAT while this check runs,
    // and the check below then reads their committed regimes (see regimeRefusal).
    await tx.select({ id: billingEntity.id }).from(billingEntity).orderBy(asc(billingEntity.id)).for("share");
    const [user] = await tx
      .select({ id: billingEntity.id })
      .from(billingEntity)
      .where(
        and(
          inArray(billingEntity.vatRegime, [...NO_VAT_CHARGED]),
          sql`(${billingEntity.defaultVatTreatmentId} = ${id}
            OR EXISTS (SELECT 1 FROM course c WHERE c.billing_entity_id = "billing_entity"."id" AND c.vat_treatment_id = ${id})
            OR EXISTS (SELECT 1 FROM lesson_pack p WHERE p.billing_entity_id = "billing_entity"."id" AND p.vat_treatment_id = ${id}))`,
        ),
      )
      .limit(1);
    if (user)
      return {
        ok: false,
        message:
          "Une entreprise sans TVA (franchise en base ou non assujettie) utilise ce traitement : il ne peut pas recevoir de taux.",
      };
  }
  const fields = changedFields(before, t.data);
  if (fields.length === 0) return { ok: true, id };
  await tx.update(vatTreatment).set(columnsOf(vatTreatment, t.data)).where(eq(vatTreatment.id, id));
  await log(tx, who, id, "update", { fields });
  return { ok: true, id };
}

/** Removes a treatment nothing uses (no course, lesson pack, invoice line nor business default). */
export async function deleteTreatment(tx: Tx, userId: string, id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: GONE };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  const [t] = await tx.select({ id: vatTreatment.id }).from(vatTreatment).where(eq(vatTreatment.id, id)).for("update");
  if (!t) return { ok: false, message: GONE };
  const [used] = await tx
    .select({ n: sql<number>`1` })
    .from(vatTreatment)
    .where(
      and(
        eq(vatTreatment.id, id),
        sql`(EXISTS (SELECT 1 FROM course c WHERE c.vat_treatment_id = ${id})
          OR EXISTS (SELECT 1 FROM lesson_pack p WHERE p.vat_treatment_id = ${id})
          OR EXISTS (SELECT 1 FROM ${invoiceLine} l WHERE l.vat_treatment_id = ${id})
          OR EXISTS (SELECT 1 FROM billing_entity e WHERE e.default_vat_treatment_id = ${id}))`,
      ),
    );
  if (used)
    return {
      ok: false,
      message: "Ce traitement est utilisé par des cours, des carnets, des factures ou une entreprise : il est gardé.",
    };
  await tx.delete(vatTreatment).where(eq(vatTreatment.id, id));
  await log(tx, who, id, "delete", null);
  return { ok: true, id };
}
