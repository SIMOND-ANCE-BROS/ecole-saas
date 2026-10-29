import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import {
  DOCUMENT_LABELS,
  DUE_WITHIN_DAYS_MAX,
  effectiveRequirements,
  REQUIRABLE_TYPES,
  type RequirableType,
  type Requirement,
  VALIDITY_MONTHS_MAX,
} from "../domain/people/documents";
import { issuePath } from "../lib/form-errors";
import type { Tx } from "./index";
import { auditLog, documentRequirement, enrollment, enrollmentCourse, member, person, studentDocument } from "./schema";

/**
 * Documents received for each student and those the school asks for (#287).
 * Tracking only, no file. Every change is written to the audit log. Always
 * within the `withSchool()` transaction (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
export type Result = { ok: true } | { ok: false; message: string };

const STUDENT_GONE = "Cet élève n’existe plus.";

/** The member writing, for the audit log; null if the account is no longer a member. */
async function actorOf(tx: Tx, userId: string): Promise<string | null> {
  const [m] = await tx.select({ id: member.id }).from(member).where(eq(member.userId, userId));
  return m?.id ?? null;
}

// ---------------------------------------------------------------------------
// What the school asks for (settings, management)
// ---------------------------------------------------------------------------

/** The school's requirements, one per type the school can ask for, defaults included. */
export async function readRequirements(tx: Tx): Promise<Requirement[]> {
  const saved = await tx
    .select({
      type: documentRequirement.type,
      required: documentRequirement.required,
      minorsOnly: documentRequirement.minorsOnly,
      validityMonths: documentRequirement.validityMonths,
      dueWithinDays: documentRequirement.dueWithinDays,
    })
    .from(documentRequirement);
  return effectiveRequirements(
    saved.flatMap((r) => (r.type === "other" ? [] : [{ ...r, type: r.type satisfies RequirableType }])),
  );
}

const requirementFields = z.object({
  type: z.enum(REQUIRABLE_TYPES, { error: "Document inconnu." }),
  required: z.boolean({ error: "Saisie invalide." }),
  minorsOnly: z.boolean({ error: "Saisie invalide." }),
  validityMonths: z
    .number({ error: "Validité : un nombre de mois." })
    .int("Validité : un nombre entier de mois.")
    .min(1, "Validité : au moins 1 mois.")
    .max(VALIDITY_MONTHS_MAX, `Validité : ${VALIDITY_MONTHS_MAX} mois au plus.`)
    .nullable(),
  dueWithinDays: z
    .number({ error: "Délai : un nombre de jours." })
    .int("Délai : un nombre entier de jours.")
    .min(0, "Délai : 0 jour au moins.")
    .max(DUE_WITHIN_DAYS_MAX, `Délai : ${DUE_WITHIN_DAYS_MAX} jours au plus.`),
});

/** One requirement per type, each type once. */
export const validRequirements = z
  .array(requirementFields, { error: "Saisie invalide." })
  .refine((rs) => new Set(rs.map((r) => r.type)).size === rs.length, { message: "Saisie invalide." });

/** Saves the documents the school asks for; each type that changes is written to the audit log. */
export async function saveRequirements(
  tx: Tx,
  userId: string,
  entry: z.input<typeof validRequirements>,
): Promise<Result> {
  const r = validRequirements.safeParse(entry);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? "Saisie invalide." };
  const before = await readRequirements(tx);
  const actor = await actorOf(tx, userId);
  for (const next of r.data) {
    const was = before.find((b) => b.type === next.type);
    if (
      was &&
      was.required === next.required &&
      was.minorsOnly === next.minorsOnly &&
      was.validityMonths === next.validityMonths &&
      was.dueWithinDays === next.dueWithinDays
    )
      continue;
    await tx
      .insert(documentRequirement)
      .values({
        schoolId: CURRENT_SCHOOL,
        type: next.type,
        required: next.required,
        minorsOnly: next.minorsOnly,
        validityMonths: next.validityMonths,
        dueWithinDays: next.dueWithinDays,
      })
      .onConflictDoUpdate({
        target: [documentRequirement.schoolId, documentRequirement.type],
        set: {
          required: next.required,
          minorsOnly: next.minorsOnly,
          validityMonths: next.validityMonths,
          dueWithinDays: next.dueWithinDays,
          updatedAt: sql`now()`,
        },
      });
    // The table is keyed by school and type: the row is the school's, its type is in the entry.
    await tx.insert(auditLog).values({
      schoolId: CURRENT_SCHOOL,
      actor,
      targetTable: "document_requirement",
      rowId: CURRENT_SCHOOL,
      action: "update",
      before: was ?? null,
      after: next,
    });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Documents of a student (record, front desk and management)
// ---------------------------------------------------------------------------

export type StudentDocumentRow = {
  id: string;
  type: RequirableType;
  receivedOn: string | null;
  datedOn: string | null;
  granted: boolean;
  validUntil: string | null;
};

/** The documents recorded for a student (types the school can ask for), in the order of `REQUIRABLE_TYPES`. */
export async function studentDocuments(tx: Tx, studentId: string): Promise<StudentDocumentRow[]> {
  if (!z.uuid().safeParse(studentId).success) return [];
  const rows = await tx
    .select({
      id: studentDocument.id,
      type: studentDocument.type,
      receivedOn: studentDocument.receivedOn,
      datedOn: studentDocument.datedOn,
      granted: studentDocument.granted,
      validUntil: studentDocument.validUntil,
    })
    .from(studentDocument)
    .where(eq(studentDocument.studentId, studentId))
    .orderBy(asc(studentDocument.type));
  return rows.flatMap((d) => (d.type === "other" ? [] : [{ ...d, type: d.type satisfies RequirableType }]));
}

/**
 * First enrollment date of the student in the season (active or trial
 * enrollments): the documents are due from it. null: not enrolled, nothing is chased.
 */
export async function firstEnrollmentDate(tx: Tx, studentId: string, seasonId: string): Promise<string | null> {
  const [row] = await tx
    .select({ on: sql<string | null>`min(${enrollment.enrolledOn})::text` })
    .from(enrollmentCourse)
    .innerJoin(enrollment, eq(enrollment.id, enrollmentCourse.enrollmentId))
    .where(
      and(
        eq(enrollmentCourse.studentId, studentId),
        eq(enrollment.seasonId, seasonId),
        sql`${enrollment.status} IN ('active', 'trial')`,
      ),
    );
  return row?.on ?? null;
}

const documentFields = z.object(
  {
    type: z.enum(REQUIRABLE_TYPES, { error: "Document inconnu." }),
    receivedOn: z.iso.date("Date de réception invalide"),
    datedOn: z.iso.date("Date du document invalide").nullable(),
    validUntil: z.iso.date("Date de fin de validité invalide").nullable(),
    granted: z.boolean({ error: "Saisie invalide." }),
  },
  { error: "Saisie invalide." },
);

/** A document entered on the record: received on a past day, dated before, valid at least from its date. */
export const validDocumentInput = (today: string) =>
  documentFields
    .refine((d) => d.receivedOn <= today, {
      path: issuePath(documentFields, "receivedOn"),
      message: "La date de réception ne peut pas être dans le futur.",
    })
    .refine((d) => d.datedOn === null || d.datedOn <= d.receivedOn, {
      path: issuePath(documentFields, "datedOn"),
      message: "Le document ne peut pas être daté après sa réception.",
    })
    .refine((d) => d.validUntil === null || d.validUntil >= (d.datedOn ?? d.receivedOn), {
      path: issuePath(documentFields, "validUntil"),
      message: "La fin de validité doit suivre la date du document.",
    })
    // A medical certificate has no « yes or no »: it is handed in or not.
    .refine((d) => d.granted || d.type !== "medical_certificate", {
      path: issuePath(documentFields, "granted"),
      message: "Un certificat médical ne se refuse pas.",
    });
export type DocumentInput = z.input<typeof documentFields>;

const loggedDocument = (d: Omit<StudentDocumentRow, "id"> & { studentId: string }) => ({
  studentId: d.studentId,
  type: d.type,
  receivedOn: d.receivedOn,
  datedOn: d.datedOn,
  granted: d.granted,
  validUntil: d.validUntil,
});

/**
 * The student's document of this type, locked for the change: two people
 * saving the same document at once are serialised (a transaction lock on the
 * pair, since `FOR UPDATE` locks nothing while no row exists), so the audit
 * log always sees the state each change replaced.
 */
async function current(tx: Tx, studentId: string, type: RequirableType) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`student_document:${studentId}:${type}`}, 0))`);
  const [d] = await tx
    .select({
      id: studentDocument.id,
      receivedOn: studentDocument.receivedOn,
      datedOn: studentDocument.datedOn,
      granted: studentDocument.granted,
      validUntil: studentDocument.validUntil,
    })
    .from(studentDocument)
    .where(and(eq(studentDocument.studentId, studentId), eq(studentDocument.type, type)))
    .for("update");
  return d ?? null;
}

async function studentExists(tx: Tx, studentId: string): Promise<boolean> {
  if (!z.uuid().safeParse(studentId).success) return false;
  const [p] = await tx
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.id, studentId), eq(person.isStudent, true)));
  return p !== undefined;
}

/**
 * Records a document as handed in, or corrects it: one row per student and
 * type, its previous state kept in the audit log.
 */
export async function saveDocument(
  tx: Tx,
  userId: string,
  studentId: string,
  entry: DocumentInput,
  today: string,
): Promise<Result> {
  const r = validDocumentInput(today).safeParse(entry);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? "Saisie invalide." };
  if (!(await studentExists(tx, studentId))) return { ok: false, message: STUDENT_GONE };
  const d = r.data;
  const was = await current(tx, studentId, d.type);
  const [{ id }] = await tx
    .insert(studentDocument)
    .values({
      schoolId: CURRENT_SCHOOL,
      studentId,
      type: d.type,
      receivedOn: d.receivedOn,
      datedOn: d.datedOn,
      granted: d.granted,
      validUntil: d.validUntil,
    })
    .onConflictDoUpdate({
      target: [studentDocument.studentId, studentDocument.type],
      set: { receivedOn: d.receivedOn, datedOn: d.datedOn, granted: d.granted, validUntil: d.validUntil },
    })
    .returning({ id: studentDocument.id });
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: await actorOf(tx, userId),
    targetTable: "student_document",
    rowId: id,
    action: was ? "update" : "insert",
    before: was ? loggedDocument({ ...was, studentId, type: d.type }) : null,
    after: loggedDocument({ ...d, studentId }),
  });
  return { ok: true };
}

/**
 * « Reçu aujourd’hui » in one click: handed in today, granted, for a document
 * without validity. One whose validity runs from its own date (the medical
 * certificate) needs that date: `saveDocument`, from the form.
 */
export async function receiveToday(
  tx: Tx,
  userId: string,
  studentId: string,
  type: RequirableType,
  today: string,
): Promise<Result> {
  const requirement = (await readRequirements(tx)).find((q) => q.type === type);
  if (!requirement) return { ok: false, message: "Document inconnu." };
  if (requirement.validityMonths !== null) return { ok: false, message: "Indiquez la date du document." };
  return saveDocument(
    tx,
    userId,
    studentId,
    { type, receivedOn: today, datedOn: null, granted: true, validUntil: null },
    today,
  );
}

/** Back to « non reçu » (entered on the wrong student, by mistake); the audit log keeps what it was. */
export async function removeDocument(tx: Tx, userId: string, studentId: string, type: RequirableType): Promise<Result> {
  if (!(await studentExists(tx, studentId))) return { ok: false, message: STUDENT_GONE };
  const was = await current(tx, studentId, type);
  if (!was) return { ok: true };
  await tx.delete(studentDocument).where(eq(studentDocument.id, was.id));
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: await actorOf(tx, userId),
    targetTable: "student_document",
    rowId: was.id,
    action: "delete",
    before: loggedDocument({ ...was, studentId, type }),
    after: null,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Students list: « Documents manquants » (#287)
// ---------------------------------------------------------------------------

/**
 * Labels of the required documents overdue for the row's student (`person`),
 * the SQL twin of `missingDocuments` (src/domain/people/documents.ts): only for
 * a student enrolled in the season (active or trial), once the delay after
 * their first enrollment date of the season is over; an expired document is
 * to bring again, a refused one is not. Requirements come resolved from the
 * domain (defaults included), so the rule is decided in one place.
 */
export function missingDocumentsSql(
  requirements: readonly Requirement[],
  seasonId: string | null,
  today: string,
): SQL<string[]> {
  const required = requirements.filter((r) => r.required);
  if (!seasonId || required.length === 0) return sql<string[]>`'{}'::text[]`;
  const id = sql`${person}.${sql.identifier("id")}`;
  const enrolledOn = sql`(
    SELECT min(i.enrolled_on) FROM enrollment_course ic JOIN enrollment i ON i.id = ic.enrollment_id
    WHERE ic.student_id = ${id} AND i.season_id = ${seasonId} AND i.status IN ('active', 'trial'))`;
  const minor = sql`(${person.birthDate} IS NOT NULL AND date_part('year', age(${today}::date, ${person.birthDate})) < 18)`;
  // A document that expired after the enrollment gets the same delay from the day after its end.
  const from = (type: string) => sql`greatest(${enrolledOn}, (
    SELECT sd.valid_until + 1 FROM student_document sd WHERE sd.student_id = ${id} AND sd.type = ${type}::document_type))`;
  const items = required.map(
    (r) => sql`CASE WHEN ${r.minorsOnly ? minor : sql`true`}
      AND ${enrolledOn} IS NOT NULL
      AND ${from(r.type)} + ${r.dueWithinDays}::int < ${today}::date
      AND NOT EXISTS (
        SELECT 1 FROM student_document sd WHERE sd.student_id = ${id} AND sd.type = ${r.type}::document_type
          AND (sd.valid_until IS NULL OR sd.valid_until >= ${today}::date)
      ) THEN ${DOCUMENT_LABELS[r.type]}::text END`,
  );
  return sql<string[]>`array_remove(ARRAY[${sql.join(items, sql`, `)}]::text[], NULL)`;
}
