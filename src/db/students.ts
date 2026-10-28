import { and, asc, eq, or, type SQL, sql } from "drizzle-orm";
import { issuePath } from "../lib/form-errors";
import { z } from "zod";
import { CONTACT_COLUMNS, STUDENT_COLUMNS } from "../domain/filters/columns";
import { EMPTY_FILTER, type Filter, type Sort } from "../domain/filters/filters";
import { offsetOf, PAGE_SIZE } from "../domain/filters/pagination";
import { ENROLLMENT_STATUS_LABELS, STATUS_PRIORITY } from "../domain/enrollment/statuses";
import { SHORT_DAYS } from "../domain/schedule/days";
import { todayInParis } from "../domain/people/age";
import { filterCondition, columnOrder } from "./filters";
import type { Tx } from "./index";
import {
  addRelationship,
  searchCondition,
  createPerson,
  payableStudents,
  type Duplicate,
  likelyDuplicates,
  type PersonRecord,
  readPerson,
  type Result,
  type PersonInput,
  validPersonInput,
} from "./people";
import { relationship, person } from "./schema";
import { has } from "../lib/has";

/**
 * Students and contacts (#77): the same `person` table, presented plainly.
 * A student has guardians, emergency contacts and a payer
 * (« facturé à »); a contact is a parent, a payer or an organisation.
 * Always within the `withSchool()` transaction (RLS).
 */

const isUuid = (v: string) => z.uuid().safeParse(v).success;
const currentId = sql`${person}.${sql.identifier("id")}`;
const sqlName = (alias: string) =>
  sql`coalesce(${sql.identifier(alias)}.company_name, concat_ws(' ', ${sql.identifier(alias)}.first_name, ${sql.identifier(alias)}.last_name))`;

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export type StudentRow = {
  id: string;
  firstName: string | null;
  name: string;
  birthDate: string | null;
  /** Student's phone, otherwise that of a guardian to contact. */
  telephone: string | null;
  guardians: string[];
  /** Payer's name; null when the student pays for themselves (or no payer is set). */
  billedTo: string | null;
  /** Student's e-mail, otherwise that of a guardian. */
  email: string | null;
  /** Courses of the season (active or trial enrollments): « Jazz lun. 17:00 ». */
  courses: string[];
  /** Enrollment status for the season (« Inscrit », « En attente »…), null without an enrollment. */
  enrollmentStatus: string | null;
  /** Emergency contacts: « Sophie Martin, 06 12 34 56 78 ». */
  toNotify: string[];
};

/**
 * Column filters (#87); `today` (Paris) is used to compute the age,
 * `seasonId` for the « Cours suivis » and « Inscription » columns (#89).
 */
export type ListOptions = {
  filter?: Filter;
  currentSort?: Sort | null;
  today?: string;
  seasonId?: string | null;
  /** Page of `pageSize` rows, from 1 (#107). */
  page?: number;
  /** Rows per page; `PAGE_SIZE` by default. */
  pageSize?: number;
};

// Computed list columns: the same expressions serve for display and for filters.
const studentPhone = sql<string | null>`coalesce(${person.phone}, (
  SELECT r.phone FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${currentId} AND l.emergency_contact AND r.phone IS NOT NULL ORDER BY r.last_name LIMIT 1))`;
const studentGuardians = sql<string[]>`coalesce((
  SELECT array_agg(${sqlName("r")} ORDER BY r.first_name) FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${currentId} AND l.type = 'legal_guardian'), '{}')`;
const studentBilledTo = sql<string | null>`(
  SELECT ${sqlName("r")} FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${currentId} AND l.pays_for ORDER BY r.last_name LIMIT 1)`;
const contactStudents = sql<string[]>`coalesce((
  SELECT array_agg(DISTINCT coalesce(e.first_name, e.last_name)) FROM relationship l JOIN person e ON e.id = l.related_person_id
  WHERE l.person_id = ${currentId} AND e.is_student AND (l.type = 'legal_guardian' OR l.pays_for)), '{}')`;

const studentEmail = sql<string | null>`coalesce(${person.email}, (
  SELECT r.email FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${currentId} AND l.type = 'legal_guardian' AND r.email IS NOT NULL ORDER BY r.last_name LIMIT 1))`;
const studentToNotify = sql<string[]>`coalesce((
  SELECT array_agg(concat_ws(', ', ${sqlName("r")}, r.phone) ORDER BY r.last_name) FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${currentId} AND l.emergency_contact), '{}')`;

/** SQL CASE from a label table (labels go through parameters). */
const labels = (value: SQL, table: Record<string | number, string>) =>
  sql`CASE ${value} ${sql.join(
    Object.entries(table).map(([k, v]) => sql`WHEN ${k} THEN ${v}`),
    sql` `,
  )} END`;

/** Short label of a course `c` of discipline `d`: « Jazz lun. 17:00 ». */
const courseLabel = () =>
  sql`concat_ws(' ', d.name, ${labels(sql`c.weekday::text`, Object.fromEntries(SHORT_DAYS.map((j, i) => [i, j] as const).slice(1)))}, to_char(c.start_time, 'HH24:MI'))`;

/** Courses attended this season (active or trial enrollments), sorted by day and time. */
function studentCourses(seasonId: string | null): SQL<string[]> {
  if (!seasonId) return sql<string[]>`'{}'::text[]`;
  return sql<string[]>`coalesce((
    SELECT array_agg(x.label ORDER BY x.weekday NULLS LAST, x.start_time) FROM (
      SELECT DISTINCT ${courseLabel()} AS label, c.weekday, c.start_time
      FROM enrollment_course ic
      JOIN enrollment i ON i.id = ic.enrollment_id
      JOIN course c ON c.id = ic.course_id
      JOIN discipline d ON d.id = c.discipline_id
      WHERE ic.student_id = ${currentId} AND i.season_id = ${seasonId} AND i.status IN ('active', 'trial')
    ) x), '{}')`;
}

/** Labels of the season's courses, by day and time: the choices of the list's « Cours » button (#107). */
export async function seasonCourseLabels(tx: Tx, seasonId: string): Promise<string[]> {
  const rows = await tx.execute<{ label: string }>(sql`
    SELECT x.label FROM (
      SELECT DISTINCT ${courseLabel()} AS label, c.weekday, c.start_time
      FROM course c JOIN discipline d ON d.id = c.discipline_id
      WHERE c.season_id = ${seasonId}
    ) x ORDER BY x.weekday NULLS LAST, x.start_time, x.label`);
  return rows.map((l) => l.label);
}

/** Enrollment status for the season; the most favourable if the student has several. */
function studentEnrollment(seasonId: string | null): SQL<string | null> {
  if (!seasonId) return sql<string | null>`NULL::text`;
  return sql<string | null>`(
    SELECT ${labels(sql`i.status::text`, ENROLLMENT_STATUS_LABELS)}
    FROM enrollment i JOIN enrollment_course ic ON ic.enrollment_id = i.id
    WHERE ic.student_id = ${currentId} AND i.season_id = ${seasonId}
    ORDER BY array_position(${sql`ARRAY[${sql.join(
      STATUS_PRIORITY.map((st) => sql`${st}`),
      sql`, `,
    )}]::text[]`}, i.status::text) LIMIT 1)`;
}

/**
 * What the students list shows: the search covers the student and their
 * relatives (name, phone…), so a child can be found through their mother.
 * Column filters apply in SQL, before paging. Null: the search cannot match.
 */
function studentScope(
  entry: string,
  { filter = EMPTY_FILTER, currentSort = null, today = todayInParis(), seasonId = null }: ListOptions,
) {
  const studentCondition = searchCondition(entry);
  const relativeCondition = searchCondition(entry, "r");
  if (entry.trim() && !studentCondition) return null;
  const validSeasonId = seasonId && isUuid(seasonId) ? seasonId : null;
  const seasonCourses = studentCourses(validSeasonId);
  const seasonStatus = studentEnrollment(validSeasonId);
  const expressions = {
    nom: { sql: sqlName("person") },
    age: { sql: sql`date_part('year', age(${today}::date, ${person.birthDate}))` },
    responsables: { sql: studentGuardians, list: true },
    facture: { sql: studentBilledTo },
    telephone: { sql: studentPhone },
    naissance: { sql: sql`${person.birthDate}` },
    email: { sql: studentEmail },
    cours: { sql: seasonCourses, list: true },
    inscription: { sql: seasonStatus },
    prevenir: { sql: studentToNotify, list: true },
  };
  const where = and(
    eq(person.isStudent, true),
    studentCondition
      ? or(
          studentCondition,
          sql`EXISTS (SELECT 1 FROM relationship l JOIN person r ON r.id = l.person_id WHERE l.related_person_id = ${currentId} AND ${relativeCondition})`,
        )
      : undefined,
    filterCondition(filter, STUDENT_COLUMNS, expressions),
  );
  return { where, order: columnOrder(currentSort, STUDENT_COLUMNS, expressions), seasonCourses, seasonStatus };
}

/** Students of the school, by name: one page of `PAGE_SIZE` rows (`page`, from 1). */
export async function listStudents(tx: Tx, entry = "", options: ListOptions = {}): Promise<StudentRow[]> {
  const scope = studentScope(entry, options);
  if (!scope) return [];
  return tx
    .select({
      id: person.id,
      firstName: person.firstName,
      name: person.lastName,
      birthDate: person.birthDate,
      telephone: studentPhone,
      guardians: studentGuardians,
      billedTo: studentBilledTo,
      email: studentEmail,
      courses: scope.seasonCourses,
      enrollmentStatus: scope.seasonStatus,
      toNotify: studentToNotify,
    })
    .from(person)
    .where(scope.where)
    .orderBy(...(scope.order ? [scope.order] : []), asc(person.lastName), asc(person.firstName), asc(person.id))
    .limit(options.pageSize ?? PAGE_SIZE)
    .offset(offsetOf(options.page ?? 1, options.pageSize ?? PAGE_SIZE));
}

/** How many students match the search and filters, all pages together. */
export async function countStudents(tx: Tx, entry = "", options: ListOptions = {}): Promise<number> {
  const scope = studentScope(entry, options);
  if (!scope) return 0;
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(person)
    .where(scope.where);
  return r.n;
}

export type ContactRow = {
  id: string;
  type: "individual" | "organisation";
  name: string;
  firstName: string | null;
  companyName: string | null;
  telephone: string | null;
  email: string | null;
  /** Students for whom the person is a guardian or whom they pay for. */
  students: string[];
};

/** Contacts: whoever is not a student, or is a guardian or payer of a student. Null: the search cannot match. */
function contactScope(entry: string, { filter = EMPTY_FILTER, currentSort = null }: ListOptions) {
  const condition = searchCondition(entry);
  if (entry.trim() && !condition) return null;
  const expressions = {
    nom: { sql: sqlName("person") },
    eleves: { sql: contactStudents, list: true },
    telephone: { sql: sql`${person.phone}` },
    email: { sql: sql`${person.email}` },
  };
  const where = and(
    or(
      eq(person.isStudent, false),
      sql`EXISTS (SELECT 1 FROM relationship l WHERE l.person_id = ${currentId} AND (l.type = 'legal_guardian' OR l.pays_for))`,
    ),
    condition ?? undefined,
    filterCondition(filter, CONTACT_COLUMNS, expressions),
  );
  return { where, order: columnOrder(currentSort, CONTACT_COLUMNS, expressions) };
}

/** Contacts by name: one page of `PAGE_SIZE` rows (`page`, from 1). */
export async function listContacts(tx: Tx, entry = "", options: ListOptions = {}): Promise<ContactRow[]> {
  const scope = contactScope(entry, options);
  if (!scope) return [];
  return tx
    .select({
      id: person.id,
      type: person.type,
      name: person.lastName,
      firstName: person.firstName,
      companyName: person.companyName,
      telephone: person.phone,
      email: person.email,
      students: contactStudents,
    })
    .from(person)
    .where(scope.where)
    .orderBy(...(scope.order ? [scope.order] : []), asc(person.lastName), asc(person.firstName), asc(person.id))
    .limit(options.pageSize ?? PAGE_SIZE)
    .offset(offsetOf(options.page ?? 1, options.pageSize ?? PAGE_SIZE));
}

/** How many contacts match the search and filters, all pages together. */
export async function countContacts(tx: Tx, entry = "", options: ListOptions = {}): Promise<number> {
  const scope = contactScope(entry, options);
  if (!scope) return 0;
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(person)
    .where(scope.where);
  return r.n;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export type StudentRelative = {
  relationshipId: string;
  id: string;
  name: string;
  telephone: string | null;
  email: string | null;
  toNotify: boolean;
  paysFor: boolean;
  relation: "legal_guardian" | "partner" | "other";
  /** "incoming": this relative is <relation> of the student; "outgoing": the student is <relation> of this relative. */
  direction: "outgoing" | "incoming";
};

export type StudentRecord = Omit<PersonRecord, "relationships"> & {
  isStudent: boolean;
  guardians: StudentRelative[];
  otherRelationships: StudentRelative[];
  /** Who receives the invoices: the student themselves, a person, or nobody set (minor without a payer). */
  billedTo: { type: "self" } | { type: "person"; id: string; name: string } | { type: "none" };
  /** Other students of the same payer (siblings discount). */
  siblings: { id: string; firstName: string }[];
};

const adult = (birthDate: string | null, today: string) => {
  if (!birthDate) return true;
  const [a, m, j] = birthDate.split("-").map(Number);
  const [aa, mm, jj] = today.split("-").map(Number);
  return aa - a - (mm < m || (mm === m && jj < j) ? 1 : 0) >= 18;
};

export async function readStudent(tx: Tx, id: string, today: string): Promise<StudentRecord | null> {
  const p = await readPerson(tx, id);
  if (!p) return null;
  const [{ student }] = await tx.select({ student: person.isStudent }).from(person).where(eq(person.id, id));
  const relative = (l: PersonRecord["relationships"][number]): StudentRelative => ({
    relationshipId: l.id,
    id: l.other.id,
    name: l.other.name,
    telephone: l.other.telephone,
    email: l.other.email,
    toNotify: l.emergencyContact,
    paysFor: l.paysFor,
    relation: l.type,
    direction: l.direction,
  });
  const to = p.relationships.filter((l) => l.direction === "incoming");
  const payer = to.find((l) => l.paysFor);
  const billedTo: StudentRecord["billedTo"] = payer
    ? { type: "person", id: payer.other.id, name: payer.other.name }
    : adult(p.birthDate, today)
      ? { type: "self" }
      : { type: "none" };
  const siblings =
    billedTo.type === "person"
      ? (await payableStudents(tx, billedTo.id))
          .filter((d) => d.id !== id && d.id !== billedTo.id)
          .map((d) => ({ id: d.id, firstName: d.firstName }))
      : [];
  const { relationships, ...rest } = p;
  return {
    ...rest,
    isStudent: student,
    guardians: to.filter((l) => l.type === "legal_guardian").map(relative),
    // The other relatives, and the relationships entered from the student (guardian of, partner entered on their side).
    otherRelationships: relationships
      .filter((l) => l.direction === "outgoing" || l.type !== "legal_guardian")
      .map(relative),
    billedTo,
    siblings,
  };
}

export type ContactRecord = Omit<PersonRecord, "relationships"> & {
  isStudent: boolean;
  /** Students for whom the person is a guardian, whom they are an emergency contact for or whom they pay for. */
  students: {
    relationshipId: string;
    id: string;
    name: string;
    guardian: boolean;
    paysFor: boolean;
    toNotify: boolean;
  }[];
};

export async function readContact(tx: Tx, id: string): Promise<ContactRecord | null> {
  const p = await readPerson(tx, id);
  if (!p) return null;
  const [{ student }] = await tx.select({ student: person.isStudent }).from(person).where(eq(person.id, id));
  const { relationships, ...rest } = p;
  return {
    ...rest,
    isStudent: student,
    students: relationships
      .filter((l) => l.direction === "outgoing")
      .map((l) => ({
        relationshipId: l.id,
        id: l.other.id,
        name: l.other.name,
        guardian: l.type === "legal_guardian",
        paysFor: l.paysFor,
        toNotify: l.emergencyContact,
      })),
  };
}

// ---------------------------------------------------------------------------
// Guided creation of a student
// ---------------------------------------------------------------------------

export const otherValidPerson = z.union([z.object({ id: z.uuid() }), z.object({ newPerson: validPersonInput })]);

const studentFields = z.object({
  student: validPersonInput,
  guardian: otherValidPerson.nullable(),
  toNotify: z.boolean(),
  billing: z.union([
    z.object({ type: z.literal("self") }),
    z.object({ type: z.literal("guardian") }),
    z.object({ type: z.literal("other"), payer: otherValidPerson }),
  ]),
});

export const validStudentInput = studentFields
  .refine((s) => s.student.type === "individual", {
    path: issuePath(studentFields, "student"),
    message: "Un élève est un particulier.",
  })
  .refine((s) => s.billing.type !== "guardian" || s.guardian !== null, {
    path: issuePath(studentFields, "billing"),
    message: "Indiquez le responsable à facturer.",
  });

export type StudentInput = z.output<typeof validStudentInput>;
/** Who a likely duplicate would be in the new entry. */
export type DuplicateWithRole = Duplicate & { role: "student" | "guardian" | "payer" };

async function resolve(tx: Tx, p: z.output<typeof otherValidPerson>): Promise<string | null> {
  if (has(p, "id")) {
    const [x] = await tx.select({ id: person.id }).from(person).where(eq(person.id, p.id));
    return x?.id ?? null;
  }
  const r = await createPerson(tx, p.newPerson, true);
  return r.status === "ok" ? r.id : null;
}

/** Error that rolls back the whole creation: nothing is kept half-done. */
export class CreationRefusal extends Error {}

/**
 * Creates the student, their guardian (existing or new) and their payer in a
 * single transaction. Without `confirmed`, first returns the likely duplicates
 * of each new person.
 */
export async function createStudent(
  tx: Tx,
  entry: StudentInput,
  confirmed: boolean,
): Promise<{ status: "ok"; id: string } | { status: "duplicates"; duplicates: DuplicateWithRole[] }> {
  if (!confirmed) {
    const nextItems: [DuplicateWithRole["role"], PersonInput][] = [["student", entry.student]];
    if (entry.guardian && has(entry.guardian, "newPerson")) nextItems.push(["guardian", entry.guardian.newPerson]);
    if (entry.billing.type === "other" && has(entry.billing.payer, "newPerson"))
      nextItems.push(["payer", entry.billing.payer.newPerson]);
    const duplicates: DuplicateWithRole[] = [];
    for (const [role, s] of nextItems) duplicates.push(...(await likelyDuplicates(tx, s)).map((d) => ({ ...d, role })));
    if (duplicates.length > 0) return { status: "duplicates", duplicates };
  }

  const created = await createPerson(tx, entry.student, true);
  if (created.status !== "ok") throw new CreationRefusal("Création impossible.");
  const id = created.id;
  await tx.update(person).set({ isStudent: true }).where(eq(person.id, id));

  if (entry.guardian) {
    const guardianId = await resolve(tx, entry.guardian);
    if (!guardianId) throw new CreationRefusal("Responsable introuvable.");
    const r = await addRelationship(tx, {
      personId: guardianId,
      relatedPersonId: id,
      type: "legal_guardian",
      emergencyContact: entry.toNotify,
      paysFor: entry.billing.type === "guardian",
    });
    if (!r.ok) throw new CreationRefusal(r.message);
  }
  if (entry.billing.type === "other") {
    const payerId = await resolve(tx, entry.billing.payer);
    if (!payerId) throw new CreationRefusal("Payeur introuvable.");
    const r = await setBilling(tx, id, { type: "person", id: payerId });
    if (!r.ok) throw new CreationRefusal(r.message);
  }
  return { status: "ok", id };
}

// ---------------------------------------------------------------------------
// Changes from the student record
// ---------------------------------------------------------------------------

/**
 * « Facturé à »: the student themselves, or a person (guardian, relative,
 * organisation). A single payer at a time; the relationship is created if needed.
 */
export async function setBilling(
  tx: Tx,
  studentId: string,
  target: { type: "self" } | { type: "person"; id: string },
): Promise<Result> {
  if (!isUuid(studentId) || (target.type === "person" && (!isUuid(target.id) || target.id === studentId))) {
    return { ok: false, message: "Choix de facturation invalide." };
  }
  const [e] = await tx.select({ id: person.id }).from(person).where(eq(person.id, studentId));
  if (!e) return { ok: false, message: "Cet élève n’existe plus." };
  await tx.update(relationship).set({ paysFor: false }).where(eq(relationship.relatedPersonId, studentId));
  if (target.type === "self") return { ok: true, id: studentId };

  const [direct] = await tx
    .select({ id: relationship.id })
    .from(relationship)
    .where(and(eq(relationship.personId, target.id), eq(relationship.relatedPersonId, studentId)));
  if (direct) {
    await tx.update(relationship).set({ paysFor: true }).where(eq(relationship.id, direct.id));
    return { ok: true, id: studentId };
  }
  // Relationship recorded in the other direction (partner entered from the student's record): it is reversed.
  const [inverse] = await tx
    .select({ id: relationship.id })
    .from(relationship)
    .where(and(eq(relationship.personId, studentId), eq(relationship.relatedPersonId, target.id)));
  if (inverse) {
    await tx
      .update(relationship)
      .set({ personId: target.id, relatedPersonId: studentId, paysFor: true, emergencyContact: false })
      .where(eq(relationship.id, inverse.id));
    return { ok: true, id: studentId };
  }
  const r = await addRelationship(tx, {
    personId: target.id,
    relatedPersonId: studentId,
    type: "other",
    emergencyContact: false,
    paysFor: true,
  });
  return r.ok ? { ok: true, id: studentId } : r;
}

/** Adds a legal guardian (existing or new); an existing relationship becomes « responsable ». */
export async function addGuardian(
  tx: Tx,
  studentId: string,
  guardian: z.input<typeof otherValidPerson>,
  toNotify: boolean,
): Promise<Result> {
  const r = otherValidPerson.safeParse(guardian);
  if (!r.success || !isUuid(studentId)) return { ok: false, message: "Saisie invalide." };
  const [e] = await tx.select({ id: person.id }).from(person).where(eq(person.id, studentId));
  if (!e) return { ok: false, message: "Cet élève n’existe plus." };
  const guardianId = await resolve(tx, r.data);
  if (!guardianId || guardianId === studentId) return { ok: false, message: "Responsable introuvable." };
  const [existing] = await tx
    .select({ id: relationship.id })
    .from(relationship)
    .where(and(eq(relationship.personId, guardianId), eq(relationship.relatedPersonId, studentId)));
  if (existing) {
    await tx
      .update(relationship)
      .set({ type: "legal_guardian", emergencyContact: toNotify })
      .where(eq(relationship.id, existing.id));
    return { ok: true, id: existing.id };
  }
  return addRelationship(tx, {
    personId: guardianId,
    relatedPersonId: studentId,
    type: "legal_guardian",
    emergencyContact: toNotify,
    paysFor: false,
  });
}

/** A contact becomes a student (or stops being one). */
export async function markStudent(tx: Tx, id: string, student: boolean): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: "Personne introuvable." };
  const rows = await tx
    .update(person)
    .set({ isStudent: student })
    .where(eq(person.id, id))
    .returning({ id: person.id });
  return rows.length === 1 ? { ok: true, id } : { ok: false, message: "Personne introuvable." };
}

/** « À prévenir en cas d'urgence » for a relative of the student. */
export async function changeNotify(tx: Tx, relationshipId: string, toNotify: boolean): Promise<Result> {
  if (!isUuid(relationshipId)) return { ok: false, message: "Ce lien n’existe plus." };
  const rows = await tx
    .update(relationship)
    .set({ emergencyContact: toNotify })
    .where(eq(relationship.id, relationshipId))
    .returning({ id: relationship.id });
  return rows.length === 1 ? { ok: true, id: relationshipId } : { ok: false, message: "Ce lien n’existe plus." };
}

/** Student or contact: serves the old /personnes/<id> URLs. null if the person does not exist. */
export async function isStudent(tx: Tx, id: string): Promise<boolean | null> {
  if (!isUuid(id)) return null;
  const [p] = await tx.select({ student: person.isStudent }).from(person).where(eq(person.id, id));
  return p ? p.student : null;
}

/** Bill a known person or one just created (organisation, other relative). */
export async function billTo(tx: Tx, studentId: string, payer: unknown): Promise<Result> {
  const p = otherValidPerson.safeParse(payer);
  if (!p.success) return { ok: false, message: "Vérifiez les informations du payeur." };
  const id = await resolve(tx, p.data);
  return id ? setBilling(tx, studentId, { type: "person", id }) : { ok: false, message: "Payeur introuvable." };
}
