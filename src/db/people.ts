import { type AnyColumn, and, asc, desc, eq, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { displayedName } from "../domain/people/name";
import type { Tx } from "./index";
import {
  course,
  discipline,
  studentDocument,
  enrollment,
  enrollmentCourse,
  relationship,
  person,
  season,
} from "./schema";

/**
 * People (students, parents, partners, professional payers) and relationships
 * between them. Always within the `withSchool()` transaction: RLS limits
 * reads and writes to the current school.
 */

const MINIMUM_LENGTH = 2;
const MAX_RESULTS = 50;
const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;

/** Lowercase without accents, on the database side (no extension) and on the input side. */
const DIACRITICS = "àâäáãéèêëíìîïóòôöõúùûüçñ";
const SANS_ACCENTS = "aaaaaeeeeiiiiooooouuuucn";
const normalizeColumn = (column: AnyColumn) =>
  sql`translate(lower(coalesce(${column}, '')), ${DIACRITICS}, ${SANS_ACCENTS})`;

function normalize(entry: string): string {
  return entry.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Escapes the LIKE wildcards (%, _, \) of an input. */
function contient(text: string): string {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}

const digits = (v: string) => v.replace(/\D/g, "");
const phoneDigits = sql`regexp_replace(coalesce(${person.phone}, ''), '[^0-9]', '', 'g')`;

export { displayedName as nomAffiche };

// ---------------------------------------------------------------------------
// Search and list
// ---------------------------------------------------------------------------

/**
 * Related people, in both directions, written with the table names: in
 * a `select`, Drizzle does not write the table name before `person.id`.
 */
const currentId = sql`${person}.${sql.identifier("id")}`;
const liees = sql<string[]>`coalesce((
  SELECT array_agg(coalesce(a.company_name, concat_ws(' ', a.first_name, a.last_name)) ORDER BY a.first_name, a.last_name)
  FROM relationship l JOIN person a ON a.id = CASE WHEN l.person_id = ${currentId} THEN l.related_person_id ELSE l.person_id END
  WHERE l.person_id = ${currentId} OR l.related_person_id = ${currentId}
), '{}')`;

const resultColumns = {
  id: person.id,
  type: person.type,
  name: person.lastName,
  firstName: person.firstName,
  companyName: person.companyName,
  birthDate: person.birthDate,
  email: person.email,
  telephone: person.phone,
  liees,
};

export type PersonResult = {
  id: string;
  type: "particulier" | "professionnel";
  name: string;
  firstName: string | null;
  companyName: string | null;
  birthDate: string | null;
  email: string | null;
  telephone: string | null;
  /** Names of the related people, sorted. */
  liees: string[];
};

/**
 * Search by last name, first name, company name, e-mail or phone (digits
 * only, spaces ignored). Accent- and case-insensitive.
 */
/**
 * Condition "person `alias` matches the input": last name, first name (in
 * both orders), company name, e-mail, phone (digits only), ignoring
 * accents and case; null if the input is too short.
 */
export function searchCondition(entry: string, alias = "person"): SQL | null {
  const text = normalize(entry);
  if (text.length < MINIMUM_LENGTH) return null;
  const pattern = contient(text);
  const col = (c: string) =>
    sql`translate(lower(coalesce(${sql.identifier(alias)}.${sql.identifier(c)}, '')), ${DIACRITICS}, ${SANS_ACCENTS})`;
  const conditions: SQL[] = [
    sql`${col("last_name")} LIKE ${pattern}`,
    sql`${col("first_name")} LIKE ${pattern}`,
    sql`${col("company_name")} LIKE ${pattern}`,
    sql`(${col("first_name")} || ' ' || ${col("last_name")}) LIKE ${pattern}`,
    sql`(${col("last_name")} || ' ' || ${col("first_name")}) LIKE ${pattern}`,
    sql`lower(coalesce(${sql.identifier(alias)}.email, '')) LIKE ${pattern}`,
  ];
  if (digits(text).length >= 4) {
    conditions.push(
      sql`regexp_replace(coalesce(${sql.identifier(alias)}.phone, ''), '[^0-9]', '', 'g') LIKE ${contient(digits(text))}`,
    );
  }
  return or(...conditions) ?? null;
}

/** Search among all the school's people (see searchCondition). */
export async function searchPeople(tx: Tx, entry: string): Promise<PersonResult[]> {
  const condition = searchCondition(entry);
  if (!condition) return [];
  return tx
    .select(resultColumns)
    .from(person)
    .where(condition)
    .orderBy(asc(person.lastName), asc(person.firstName))
    .limit(MAX_RESULTS);
}

/** All the school's people, by name (no search input). */
export function listPeople(tx: Tx, limit = 200): Promise<PersonResult[]> {
  return tx.select(resultColumns).from(person).orderBy(asc(person.lastName), asc(person.firstName)).limit(limit);
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

export const RELATIONSHIP_TYPES = ["representant_legal", "conjoint", "autre"] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export type RelationshipItem = {
  id: string;
  /** The other person of the relationship. */
  autre: { id: string; name: string; telephone: string | null; email: string | null };
  /** « de »: the record's person is <type> of the other; « vers »: the other is <type> of them. */
  sens: "de" | "vers";
  type: RelationshipType;
  emergencyContact: boolean;
  paysFor: boolean;
};

export type PersonRecord = {
  id: string;
  type: "particulier" | "professionnel";
  name: string;
  firstName: string | null;
  companyName: string | null;
  siren: string | null;
  birthDate: string | null;
  email: string | null;
  telephone: string | null;
  address: string | null;
  notes: string | null;
  relationships: RelationshipItem[];
  /** Courses attended as a student, most recent season first. */
  courses: {
    id: string;
    season: string;
    discipline: string;
    level: string | null;
    weekday: number | null;
    startTime: string;
    status: (typeof enrollment.status.enumValues)[number];
    payerId: string;
    /** Attendance taken for this student in this course. */
    presents: number;
    absents: number;
  }[];
  documents: { type: (typeof studentDocument.type.enumValues)[number]; granted: boolean; validUntil: string | null }[];
};

/** A student's presences or absences at the lessons of the row's course. */
const attendances = (studentId: string, present: boolean) => sql<number>`(
  SELECT count(*)::int FROM attendance p JOIN lesson s ON s.id = p.lesson_id
  WHERE s.course_id = ${course}.${sql.identifier("id")} AND p.student_id = ${studentId} AND p.present = ${present}
)`;

export async function readPerson(tx: Tx, id: string): Promise<PersonRecord | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [p] = await tx
    .select({
      id: person.id,
      type: person.type,
      name: person.lastName,
      firstName: person.firstName,
      companyName: person.companyName,
      siren: person.siren,
      birthDate: person.birthDate,
      email: person.email,
      telephone: person.phone,
      address: person.address,
      notes: person.notes,
    })
    .from(person)
    .where(eq(person.id, id));
  if (!p) return null;

  const autre = alias(person, "autre");
  const relationships = await tx
    .select({
      id: relationship.id,
      personId: relationship.personId,
      type: relationship.type,
      emergencyContact: relationship.emergencyContact,
      paysFor: relationship.paysFor,
      otherId: autre.id,
      name: autre.lastName,
      firstName: autre.firstName,
      companyName: autre.companyName,
      telephone: autre.phone,
      email: autre.email,
    })
    .from(relationship)
    .innerJoin(
      autre,
      sql`${autre.id} = CASE WHEN ${relationship.personId} = ${id} THEN ${relationship.relatedPersonId} ELSE ${relationship.personId} END`,
    )
    .where(or(eq(relationship.personId, id), eq(relationship.relatedPersonId, id)))
    .orderBy(asc(autre.firstName), asc(autre.lastName));

  const followed = await tx
    .select({
      id: course.id,
      season: season.label,
      discipline: discipline.name,
      level: course.level,
      weekday: course.weekday,
      startTime: course.startTime,
      status: enrollment.status,
      payerId: enrollment.payerId,
      presents: attendances(id, true),
      absents: attendances(id, false),
    })
    .from(enrollmentCourse)
    .innerJoin(enrollment, eq(enrollment.id, enrollmentCourse.enrollmentId))
    .innerJoin(course, eq(course.id, enrollmentCourse.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(season, eq(season.id, course.seasonId))
    .where(eq(enrollmentCourse.studentId, id))
    .orderBy(desc(season.startDate), sql`${course.weekday} NULLS LAST`, asc(course.startTime));

  const documents = await tx
    .select({ type: studentDocument.type, granted: studentDocument.granted, validUntil: studentDocument.validUntil })
    .from(studentDocument)
    .where(eq(studentDocument.studentId, id))
    .orderBy(asc(studentDocument.type));

  return {
    ...p,
    relationships: relationships.map((l) => ({
      id: l.id,
      autre: { id: l.otherId, name: displayedName(l), telephone: l.telephone, email: l.email },
      sens: l.personId === id ? "de" : "vers",
      type: l.type,
      emergencyContact: l.emergencyContact,
      paysFor: l.paysFor,
    })),
    courses: followed.map((c) => ({ ...c, startTime: c.startTime.slice(0, 5) })),
    documents,
  };
}

/**
 * Students a payer can enroll: themselves if they are a student, and
 * the people they pay for (relationship « paie pour »). By first name.
 */
export async function payableStudents(
  tx: Tx,
  payerId: string,
): Promise<{ id: string; firstName: string; name: string; birthDate: string | null }[]> {
  if (!z.uuid().safeParse(payerId).success) return [];
  const rows = await tx
    .select({ id: person.id, firstName: person.firstName, name: person.lastName, birthDate: person.birthDate })
    .from(person)
    .where(
      or(
        // The payer themselves only if they are a student: a paying parent is not offered for enrollment.
        and(eq(person.id, payerId), eq(person.isStudent, true)),
        sql`EXISTS (SELECT 1 FROM relationship l WHERE l.person_id = ${payerId} AND l.related_person_id = ${currentId} AND l.pays_for)`,
      ),
    )
    .orderBy(asc(person.firstName), asc(person.lastName));
  return rows.map((l) => ({ ...l, firstName: l.firstName ?? l.name }));
}

/** People who pay for a student (relationship « paie pour »). */
export async function payersOf(tx: Tx, studentId: string): Promise<{ id: string; name: string }[]> {
  if (!z.uuid().safeParse(studentId).success) return [];
  const payers = await tx
    .select({ id: person.id, name: person.lastName, firstName: person.firstName, companyName: person.companyName })
    .from(relationship)
    .innerJoin(person, eq(person.id, relationship.personId))
    .where(and(eq(relationship.relatedPersonId, studentId), eq(relationship.paysFor, true)))
    .orderBy(asc(person.lastName));
  return payers.map((p) => ({ id: p.id, name: displayedName(p) }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

export const validPersonInput = z
  .object({
    type: z.enum(["particulier", "professionnel"]),
    name: z.string().trim().max(100),
    firstName: optionalText(100),
    companyName: optionalText(200),
    siren: z
      .string()
      .nullable()
      .transform((v) => (v ?? "").replace(/\s/g, "") || null)
      .refine((v) => v === null || /^\d{9}$/.test(v), "Le SIREN compte 9 chiffres"),
    birthDate: z
      .union([z.literal(""), z.iso.date("Date invalide")])
      .nullable()
      .transform((v) => v || null),
    email: z
      .union([z.literal(""), z.email("E-mail invalide")])
      .nullable()
      .transform((v) => v || null),
    telephone: optionalText(30),
    address: optionalText(300),
    notes: optionalText(2000),
  })
  .superRefine((f, ctx) => {
    if (f.type === "particulier" && !f.name)
      ctx.addIssue({ code: "custom", path: ["name"], message: "Nom obligatoire" });
    if (f.type === "professionnel" && !f.companyName)
      ctx.addIssue({ code: "custom", path: ["companyName"], message: "Raison sociale obligatoire" });
    if (f.type === "professionnel" && !f.siren)
      ctx.addIssue({ code: "custom", path: ["siren"], message: "SIREN obligatoire pour un professionnel" });
  });

export type PersonInput = z.output<typeof validPersonInput>;
export type Duplicate = { id: string; name: string; telephone: string | null };
export type Result = { ok: true; id: string } | { ok: false; message: string };

/** A professional without a named contact takes their company name as name; no birth date for them. */
const personValues = (f: PersonInput) => ({
  type: f.type,
  lastName: f.name || f.companyName || "",
  firstName: f.type === "particulier" ? f.firstName : null,
  companyName: f.type === "professionnel" ? f.companyName : null,
  siren: f.type === "professionnel" ? f.siren : null,
  birthDate: f.type === "particulier" ? f.birthDate : null,
  email: f.email,
  phone: f.telephone,
  address: f.address,
  notes: f.notes,
});

/** People already known with the same phone, e-mail, same last and first names or same company name. */
export async function likelyDuplicates(tx: Tx, f: PersonInput): Promise<Duplicate[]> {
  const conditions: SQL[] = [];
  if (f.telephone && digits(f.telephone).length >= 6) conditions.push(sql`${phoneDigits} = ${digits(f.telephone)}`);
  if (f.email) conditions.push(sql`lower(${person.email}) = lower(${f.email})`);
  if (f.type === "particulier" && f.firstName)
    conditions.push(
      sql`${normalizeColumn(person.lastName)} = ${normalize(f.name)} AND ${normalizeColumn(person.firstName)} = ${normalize(f.firstName)}`,
    );
  if (f.companyName) conditions.push(sql`${normalizeColumn(person.companyName)} = ${normalize(f.companyName)}`);
  if (conditions.length === 0) return [];
  const rows = await tx
    .select({
      id: person.id,
      name: person.lastName,
      firstName: person.firstName,
      companyName: person.companyName,
      telephone: person.phone,
    })
    .from(person)
    .where(or(...conditions))
    .orderBy(asc(person.lastName))
    .limit(5);
  return rows.map((l) => ({ id: l.id, name: displayedName(l), telephone: l.telephone }));
}

export type NewRelationship = { type: RelationshipType; emergencyContact: boolean; paysFor: boolean };

/** Rolls back the creation transaction when the requested relationship is refused. */
export class RelationshipRefusal extends Error {}

/**
 * Creates a person, optionally linked straight away to another (`de`: who is
 * <type> of whom; « nouvelle » means the created person). Without `confirmed`,
 * first returns the likely duplicates.
 */
export async function createPerson(
  tx: Tx,
  entry: PersonInput,
  confirmed: boolean,
  relationshipWith?: NewRelationship & { otherId: string; de: "nouvelle" | "autre" },
): Promise<{ status: "ok"; id: string } | { status: "doublons"; duplicates: Duplicate[] }> {
  if (!confirmed) {
    const duplicates = await likelyDuplicates(tx, entry);
    if (duplicates.length > 0) return { status: "doublons", duplicates };
  }
  const [{ id }] = await tx
    .insert(person)
    .values({ ...personValues(entry), schoolId: CURRENT_SCHOOL })
    .returning({ id: person.id });
  if (relationshipWith) {
    const { otherId: otherId, de, ...l } = relationshipWith;
    const r = await addRelationship(
      tx,
      de === "nouvelle"
        ? { ...l, personId: id, relatedPersonId: otherId }
        : { ...l, personId: otherId, relatedPersonId: id },
    );
    if (!r.ok) throw new RelationshipRefusal(r.message);
  }
  return { status: "ok", id };
}

export async function updatePerson(tx: Tx, id: string, entry: PersonInput): Promise<Result> {
  const refusal = { ok: false as const, message: "Cette personne n’existe plus." };
  if (!z.uuid().safeParse(id).success) return refusal;
  const rows = await tx.update(person).set(personValues(entry)).where(eq(person.id, id)).returning({ id: person.id });
  return rows.length === 1 ? { ok: true, id } : refusal;
}

export const validRelationship = z.object({
  personId: z.uuid(),
  relatedPersonId: z.uuid(),
  type: z.enum(RELATIONSHIP_TYPES),
  emergencyContact: z.boolean(),
  paysFor: z.boolean(),
});

/** Links two people of the school; a single relationship per pair, whatever the direction. */
export async function addRelationship(tx: Tx, entry: z.input<typeof validRelationship>): Promise<Result> {
  const l = validRelationship.safeParse(entry);
  if (!l.success) return { ok: false, message: "Lien invalide." };
  const { personId: personId, relatedPersonId: relatedPersonId } = l.data;
  if (personId === relatedPersonId) return { ok: false, message: "Une personne ne peut pas être liée à elle-même." };
  const presentes = await tx
    .select({ id: person.id })
    .from(person)
    .where(or(eq(person.id, personId), eq(person.id, relatedPersonId)));
  if (presentes.length !== 2) return { ok: false, message: "Personne introuvable." };
  const [existing] = await tx
    .select({ id: relationship.id })
    .from(relationship)
    .where(
      or(
        and(eq(relationship.personId, personId), eq(relationship.relatedPersonId, relatedPersonId)),
        and(eq(relationship.personId, relatedPersonId), eq(relationship.relatedPersonId, personId)),
      ),
    );
  if (existing) return { ok: false, message: "Ces deux personnes sont déjà liées." };
  const [{ id }] = await tx
    .insert(relationship)
    .values({
      personId: l.data.personId,
      relatedPersonId: l.data.relatedPersonId,
      type: l.data.type,
      emergencyContact: l.data.emergencyContact,
      paysFor: l.data.paysFor,
      schoolId: CURRENT_SCHOOL,
    })
    .returning({ id: relationship.id });
  return { ok: true, id };
}

/** Changes the type or flags of a relationship, without changing its direction. */
export async function updateRelationship(tx: Tx, id: string, entry: NewRelationship): Promise<Result> {
  const refusal = { ok: false as const, message: "Ce lien n’existe plus." };
  if (!z.uuid().safeParse(id).success) return refusal;
  const rows = await tx
    .update(relationship)
    .set({ type: entry.type, emergencyContact: entry.emergencyContact, paysFor: entry.paysFor })
    .where(eq(relationship.id, id))
    .returning({ id: relationship.id });
  return rows.length === 1 ? { ok: true, id } : refusal;
}

export async function deleteRelationship(tx: Tx, id: string): Promise<Result> {
  const refusal = { ok: false as const, message: "Ce lien n’existe plus." };
  if (!z.uuid().safeParse(id).success) return refusal;
  const rows = await tx.delete(relationship).where(eq(relationship.id, id)).returning({ id: relationship.id });
  return rows.length === 1 ? { ok: true, id } : refusal;
}
