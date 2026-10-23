import { and, asc, eq, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { CONTACT_COLUMNS, STUDENT_COLUMNS } from "../domain/filters/columns";
import { EMPTY_FILTER, type Filter, type Sort } from "../domain/filters/filters";
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

/**
 * Élèves et contacts (#77) : la même table `personne`, présentée en clair.
 * Un élève a des responsables, des personnes à prévenir et un payeur
 * (« facturé à ») ; un contact est un parent, un payeur ou un organisme.
 * Toujours avec la transaction d'`withSchool()` (RLS).
 */

/** Lignes au plus dans une liste : au-delà, l'accueil affine la recherche ou filtre. */
export const MAX_RESULTS = 200;
const isUuid = (v: string) => z.uuid().safeParse(v).success;
const currentId = sql`${person}.${sql.identifier("id")}`;
const sqlName = (alias: string) =>
  sql`coalesce(${sql.identifier(alias)}.company_name, concat_ws(' ', ${sql.identifier(alias)}.first_name, ${sql.identifier(alias)}.last_name))`;

// ---------------------------------------------------------------------------
// Listes
// ---------------------------------------------------------------------------

export type StudentRow = {
  id: string;
  firstName: string | null;
  name: string;
  birthDate: string | null;
  /** Téléphone de l'élève, sinon celui d'un responsable à prévenir. */
  telephone: string | null;
  guardians: string[];
  /** Nom du payeur ; null quand l'élève paie lui-même (ou qu'aucun payeur n'est indiqué). */
  billedTo: string | null;
  /** E-mail de l'élève, sinon celui d'un responsable. */
  email: string | null;
  /** Cours de la saison (inscriptions actives ou à l'essai) : « Jazz lun. 17:00 ». */
  courses: string[];
  /** Statut d'inscription de la saison (« Inscrit », « En attente »…), null sans inscription. */
  enrollmentStatus: string | null;
  /** Personnes à prévenir : « Sophie Martin, 06 12 34 56 78 ». */
  toNotify: string[];
};

/**
 * Filtres par colonne (#87) ; `aujourdhui` (Paris) sert au calcul de l'âge,
 * `saisonId` aux colonnes « Cours suivis » et « Inscription » (#89).
 */
export type ListOptions = { filter?: Filter; currentSort?: Sort | null; today?: string; seasonId?: string | null };

// Colonnes calculées des listes : les mêmes expressions servent à l'affichage et aux filtres.
const studentPhone = sql<string | null>`coalesce(${person.phone}, (
  SELECT r.phone FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${currentId} AND l.emergency_contact AND r.phone IS NOT NULL ORDER BY r.last_name LIMIT 1))`;
const studentGuardians = sql<string[]>`coalesce((
  SELECT array_agg(${sqlName("r")} ORDER BY r.first_name) FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${currentId} AND l.type = 'representant_legal'), '{}')`;
const studentBilledTo = sql<string | null>`(
  SELECT ${sqlName("r")} FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${currentId} AND l.pays_for ORDER BY r.last_name LIMIT 1)`;
const contactStudents = sql<string[]>`coalesce((
  SELECT array_agg(DISTINCT coalesce(e.first_name, e.last_name)) FROM relationship l JOIN person e ON e.id = l.related_person_id
  WHERE l.person_id = ${currentId} AND e.is_student AND (l.type = 'representant_legal' OR l.pays_for)), '{}')`;

const studentEmail = sql<string | null>`coalesce(${person.email}, (
  SELECT r.email FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${currentId} AND l.type = 'representant_legal' AND r.email IS NOT NULL ORDER BY r.last_name LIMIT 1))`;
const studentToNotify = sql<string[]>`coalesce((
  SELECT array_agg(concat_ws(', ', ${sqlName("r")}, r.phone) ORDER BY r.last_name) FROM relationship l JOIN person r ON r.id = l.person_id
  WHERE l.related_person_id = ${currentId} AND l.emergency_contact), '{}')`;

/** CASE SQL d'après une table de libellés (les libellés passent en paramètres). */
const labels = (value: SQL, table: Record<string | number, string>) =>
  sql`CASE ${value} ${sql.join(
    Object.entries(table).map(([k, v]) => sql`WHEN ${k} THEN ${v}`),
    sql` `,
  )} END`;

/** Libellé court d'un cours `c` de discipline `d` : « Jazz lun. 17:00 ». */
const courseLabel = () =>
  sql`concat_ws(' ', d.name, ${labels(sql`c.weekday::text`, Object.fromEntries(SHORT_DAYS.map((j, i) => [i, j] as const).slice(1)))}, to_char(c.start_time, 'HH24:MI'))`;

/** Cours suivis cette saison (inscriptions actives ou à l'essai), triés par jour et heure. */
function studentCourses(seasonId: string | null): SQL<string[]> {
  if (!seasonId) return sql<string[]>`'{}'::text[]`;
  return sql<string[]>`coalesce((
    SELECT array_agg(x.label ORDER BY x.jour NULLS LAST, x.heure) FROM (
      SELECT DISTINCT ${courseLabel()} AS label, c.weekday AS jour, c.start_time AS heure
      FROM enrollment_course ic
      JOIN enrollment i ON i.id = ic.enrollment_id
      JOIN course c ON c.id = ic.course_id
      JOIN discipline d ON d.id = c.discipline_id
      WHERE ic.student_id = ${currentId} AND i.season_id = ${seasonId} AND i.status IN ('active', 'essai')
    ) x), '{}')`;
}

/** Libellés des cours de la saison, par jour et heure : les choix du bouton « Cours » de la liste (#107). */
export async function seasonCourseLabels(tx: Tx, seasonId: string): Promise<string[]> {
  const rows = await tx.execute<{ label: string }>(sql`
    SELECT x.label FROM (
      SELECT DISTINCT ${courseLabel()} AS label, c.weekday AS jour, c.start_time AS heure
      FROM course c JOIN discipline d ON d.id = c.discipline_id
      WHERE c.season_id = ${seasonId}
    ) x ORDER BY x.jour NULLS LAST, x.heure, x.label`);
  return rows.map((l) => l.label);
}

/** Statut d'inscription de la saison ; le plus favorable si l'élève en a plusieurs. */
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
 * Élèves de l'école, par nom. La recherche porte sur l'élève et sur ses
 * proches (nom, téléphone…) : on retrouve un enfant par sa mère. Les filtres
 * par colonne s'appliquent en SQL, avant la limite de la liste.
 */
export async function listStudents(
  tx: Tx,
  saisie = "",
  {
    filter: filter = EMPTY_FILTER,
    currentSort: currentSort = null,
    today: today = todayInParis(),
    seasonId: seasonId = null,
  }: ListOptions = {},
): Promise<StudentRow[]> {
  const studentCondition = searchCondition(saisie);
  const relativeCondition = searchCondition(saisie, "r");
  if (saisie.trim() && !studentCondition) return [];
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
  const columnsCondition = filterCondition(filter, STUDENT_COLUMNS, expressions);
  const order = columnOrder(currentSort, STUDENT_COLUMNS, expressions);
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
      courses: seasonCourses,
      enrollmentStatus: seasonStatus,
      toNotify: studentToNotify,
    })
    .from(person)
    .where(
      and(
        eq(person.isStudent, true),
        studentCondition
          ? or(
              studentCondition,
              sql`EXISTS (SELECT 1 FROM relationship l JOIN person r ON r.id = l.person_id WHERE l.related_person_id = ${currentId} AND ${relativeCondition})`,
            )
          : undefined,
        columnsCondition,
      ),
    )
    .orderBy(...(order ? [order] : []), asc(person.lastName), asc(person.firstName))
    .limit(MAX_RESULTS);
}

export type ContactRow = {
  id: string;
  type: "particulier" | "professionnel";
  name: string;
  firstName: string | null;
  companyName: string | null;
  telephone: string | null;
  email: string | null;
  /** Élèves dont la personne est responsable ou pour qui elle paie. */
  students: string[];
};

/** Contacts : qui n'est pas élève, ou qui est responsable ou payeur d'un élève. */
export async function listContacts(
  tx: Tx,
  saisie = "",
  { filter: filter = EMPTY_FILTER, currentSort: currentSort = null }: ListOptions = {},
): Promise<ContactRow[]> {
  const condition = searchCondition(saisie);
  if (saisie.trim() && !condition) return [];
  const expressions = {
    nom: { sql: sqlName("person") },
    eleves: { sql: contactStudents, list: true },
    telephone: { sql: sql`${person.phone}` },
    email: { sql: sql`${person.email}` },
  };
  const columnsCondition = filterCondition(filter, CONTACT_COLUMNS, expressions);
  const order = columnOrder(currentSort, CONTACT_COLUMNS, expressions);
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
    .where(
      and(
        or(
          eq(person.isStudent, false),
          sql`EXISTS (SELECT 1 FROM relationship l WHERE l.person_id = ${currentId} AND (l.type = 'representant_legal' OR l.pays_for))`,
        ),
        condition ?? undefined,
        columnsCondition,
      ),
    )
    .orderBy(...(order ? [order] : []), asc(person.lastName), asc(person.firstName))
    .limit(MAX_RESULTS);
}

// ---------------------------------------------------------------------------
// Fiches
// ---------------------------------------------------------------------------

export type StudentRelative = {
  relationshipId: string;
  id: string;
  name: string;
  telephone: string | null;
  email: string | null;
  toNotify: boolean;
  paysFor: boolean;
  relation: "responsable" | "conjoint" | "autre";
  /** « vers » : ce proche est <relation> de l'élève ; « de » : l'élève est <relation> de ce proche. */
  sens: "de" | "vers";
};

export type StudentRecord = Omit<PersonRecord, "relationships"> & {
  isStudent: boolean;
  guardians: StudentRelative[];
  otherRelationships: StudentRelative[];
  /** Qui reçoit les factures : l'élève lui-même, une personne, ou personne d'indiqué (mineur sans payeur). */
  billedTo: { type: "eleve" } | { type: "personne"; id: string; name: string } | { type: "aucun" };
  /** Autres élèves du même payeur (réduction fratrie). */
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
  const [{ student: student }] = await tx.select({ student: person.isStudent }).from(person).where(eq(person.id, id));
  const relative = (l: PersonRecord["relationships"][number]): StudentRelative => ({
    relationshipId: l.id,
    id: l.autre.id,
    name: l.autre.name,
    telephone: l.autre.telephone,
    email: l.autre.email,
    toNotify: l.emergencyContact,
    paysFor: l.paysFor,
    relation: l.type === "representant_legal" ? "responsable" : l.type,
    sens: l.sens,
  });
  const to = p.relationships.filter((l) => l.sens === "vers");
  const payer = to.find((l) => l.paysFor);
  const billedTo: StudentRecord["billedTo"] = payer
    ? { type: "personne", id: payer.autre.id, name: payer.autre.name }
    : adult(p.birthDate, today)
      ? { type: "eleve" }
      : { type: "aucun" };
  const siblings =
    billedTo.type === "personne"
      ? (await payableStudents(tx, billedTo.id))
          .filter((d) => d.id !== id && d.id !== billedTo.id)
          .map((d) => ({ id: d.id, firstName: d.firstName }))
      : [];
  const { relationships: liens, ...reste } = p;
  return {
    ...reste,
    isStudent: student,
    guardians: to.filter((l) => l.type === "representant_legal").map(relative),
    // Les autres proches, et les liens enregistrés depuis l'élève (dont il est responsable, conjoint saisi de son côté).
    otherRelationships: liens.filter((l) => l.sens === "de" || l.type !== "representant_legal").map(relative),
    billedTo,
    siblings,
  };
}

export type ContactRecord = Omit<PersonRecord, "relationships"> & {
  isStudent: boolean;
  /** Élèves dont la personne est responsable, qu'elle prévient ou pour qui elle paie. */
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
  const [{ student: student }] = await tx.select({ student: person.isStudent }).from(person).where(eq(person.id, id));
  const { relationships: liens, ...reste } = p;
  return {
    ...reste,
    isStudent: student,
    students: liens
      .filter((l) => l.sens === "de")
      .map((l) => ({
        relationshipId: l.id,
        id: l.autre.id,
        name: l.autre.name,
        guardian: l.type === "representant_legal",
        paysFor: l.paysFor,
        toNotify: l.emergencyContact,
      })),
  };
}

// ---------------------------------------------------------------------------
// Création guidée d'un élève
// ---------------------------------------------------------------------------

export const otherValidPerson = z.union([z.object({ id: z.uuid() }), z.object({ newPerson: validPersonInput })]);

export const validStudentInput = z
  .object({
    student: validPersonInput,
    guardian: otherValidPerson.nullable(),
    toNotify: z.boolean(),
    billing: z.union([
      z.object({ type: z.literal("eleve") }),
      z.object({ type: z.literal("responsable") }),
      z.object({ type: z.literal("autre"), payeur: otherValidPerson }),
    ]),
  })
  .refine((s) => s.student.type === "particulier", { path: ["student"], message: "Un élève est un particulier." })
  .refine((s) => s.billing.type !== "responsable" || s.guardian !== null, {
    path: ["billing"],
    message: "Indiquez le responsable à facturer.",
  });

export type StudentInput = z.output<typeof validStudentInput>;
export type DuplicateWithRole = Duplicate & { role: "élève" | "responsable" | "payeur" };

async function resolve(tx: Tx, p: z.output<typeof otherValidPerson>): Promise<string | null> {
  if ("id" in p) {
    const [x] = await tx.select({ id: person.id }).from(person).where(eq(person.id, p.id));
    return x?.id ?? null;
  }
  const r = await createPerson(tx, p.newPerson, true);
  return r.status === "ok" ? r.id : null;
}

/** Erreur qui annule toute la création : rien n'est gardé à moitié. */
export class CreationRefusal extends Error {}

/**
 * Crée l'élève, son responsable (existant ou nouveau) et son payeur en une
 * seule transaction. Sans `confirme`, renvoie d'abord les doublons probables
 * de chaque nouvelle personne.
 */
export async function createStudent(
  tx: Tx,
  saisie: StudentInput,
  confirmed: boolean,
): Promise<{ status: "ok"; id: string } | { status: "doublons"; duplicates: DuplicateWithRole[] }> {
  if (!confirmed) {
    const nextItems: [DuplicateWithRole["role"], PersonInput][] = [["élève", saisie.student]];
    if (saisie.guardian && "newPerson" in saisie.guardian) nextItems.push(["responsable", saisie.guardian.newPerson]);
    if (saisie.billing.type === "autre" && "newPerson" in saisie.billing.payeur)
      nextItems.push(["payeur", saisie.billing.payeur.newPerson]);
    const duplicates: DuplicateWithRole[] = [];
    for (const [role, s] of nextItems) duplicates.push(...(await likelyDuplicates(tx, s)).map((d) => ({ ...d, role })));
    if (duplicates.length > 0) return { status: "doublons", duplicates };
  }

  const created = await createPerson(tx, saisie.student, true);
  if (created.status !== "ok") throw new CreationRefusal("Création impossible.");
  const id = created.id;
  await tx.update(person).set({ isStudent: true }).where(eq(person.id, id));

  if (saisie.guardian) {
    const guardianId = await resolve(tx, saisie.guardian);
    if (!guardianId) throw new CreationRefusal("Responsable introuvable.");
    const r = await addRelationship(tx, {
      personId: guardianId,
      relatedPersonId: id,
      type: "representant_legal",
      emergencyContact: saisie.toNotify,
      paysFor: saisie.billing.type === "responsable",
    });
    if (!r.ok) throw new CreationRefusal(r.message);
  }
  if (saisie.billing.type === "autre") {
    const payerId = await resolve(tx, saisie.billing.payeur);
    if (!payerId) throw new CreationRefusal("Payeur introuvable.");
    const r = await setBilling(tx, id, { type: "personne", id: payerId });
    if (!r.ok) throw new CreationRefusal(r.message);
  }
  return { status: "ok", id };
}

// ---------------------------------------------------------------------------
// Modifications depuis la fiche élève
// ---------------------------------------------------------------------------

/**
 * « Facturé à » : l'élève lui-même, ou une personne (responsable, proche,
 * organisme). Un seul payeur à la fois ; le lien est créé au besoin.
 */
export async function setBilling(
  tx: Tx,
  studentId: string,
  target: { type: "eleve" } | { type: "personne"; id: string },
): Promise<Result> {
  if (!isUuid(studentId) || (target.type === "personne" && (!isUuid(target.id) || target.id === studentId))) {
    return { ok: false, message: "Choix de facturation invalide." };
  }
  const [e] = await tx.select({ id: person.id }).from(person).where(eq(person.id, studentId));
  if (!e) return { ok: false, message: "Cet élève n’existe plus." };
  await tx.update(relationship).set({ paysFor: false }).where(eq(relationship.relatedPersonId, studentId));
  if (target.type === "eleve") return { ok: true, id: studentId };

  const [direct] = await tx
    .select({ id: relationship.id })
    .from(relationship)
    .where(and(eq(relationship.personId, target.id), eq(relationship.relatedPersonId, studentId)));
  if (direct) {
    await tx.update(relationship).set({ paysFor: true }).where(eq(relationship.id, direct.id));
    return { ok: true, id: studentId };
  }
  // Lien enregistré dans l'autre sens (conjoint saisi depuis la fiche de l'élève) : il est retourné.
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
    type: "autre",
    emergencyContact: false,
    paysFor: true,
  });
  return r.ok ? { ok: true, id: studentId } : r;
}

/** Ajoute un responsable légal (existant ou nouveau) ; un lien existant devient « responsable ». */
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
      .set({ type: "representant_legal", emergencyContact: toNotify })
      .where(eq(relationship.id, existing.id));
    return { ok: true, id: existing.id };
  }
  return addRelationship(tx, {
    personId: guardianId,
    relatedPersonId: studentId,
    type: "representant_legal",
    emergencyContact: toNotify,
    paysFor: false,
  });
}

/** Un contact devient élève (ou cesse de l'être). */
export async function markStudent(tx: Tx, id: string, student: boolean): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: "Personne introuvable." };
  const rows = await tx
    .update(person)
    .set({ isStudent: student })
    .where(eq(person.id, id))
    .returning({ id: person.id });
  return rows.length === 1 ? { ok: true, id } : { ok: false, message: "Personne introuvable." };
}

/** « À prévenir en cas d'urgence » pour un proche de l'élève. */
export async function changeNotify(tx: Tx, relationshipId: string, toNotify: boolean): Promise<Result> {
  if (!isUuid(relationshipId)) return { ok: false, message: "Ce lien n’existe plus." };
  const rows = await tx
    .update(relationship)
    .set({ emergencyContact: toNotify })
    .where(eq(relationship.id, relationshipId))
    .returning({ id: relationship.id });
  return rows.length === 1 ? { ok: true, id: relationshipId } : { ok: false, message: "Ce lien n’existe plus." };
}

/** Élève ou contact : sert aux anciennes adresses /personnes/<id>. null si la personne n'existe pas. */
export async function isStudent(tx: Tx, id: string): Promise<boolean | null> {
  if (!isUuid(id)) return null;
  const [p] = await tx.select({ student: person.isStudent }).from(person).where(eq(person.id, id));
  return p ? p.student : null;
}

/** Facturer une personne connue ou créée à l'instant (organisme, autre proche). */
export async function billTo(tx: Tx, studentId: string, payer: z.input<typeof otherValidPerson>): Promise<Result> {
  const p = otherValidPerson.safeParse(payer);
  if (!p.success) return { ok: false, message: "Vérifiez les informations du payeur." };
  const id = await resolve(tx, p.data);
  return id ? setBilling(tx, studentId, { type: "personne", id }) : { ok: false, message: "Payeur introuvable." };
}
