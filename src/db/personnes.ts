import { type AnyColumn, and, asc, desc, eq, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { displayedName } from "../domaine/personnes/nom";
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
 * Personnes (danseurs, parents, conjoints, payeurs professionnels) et liens
 * entre elles. Toujours avec la transaction de `avecEcole()` : la RLS limite
 * lectures et écritures à l'école courante.
 */

const MINIMUM_LENGTH = 2;
const MAX_RESULTS = 50;
const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;

/** Minuscules sans accents, côté base (sans extension) et côté saisie. */
const ACCENTS = "àâäáãéèêëíìîïóòôöõúùûüçñ";
const SANS_ACCENTS = "aaaaaeeeeiiiiooooouuuucn";
const normalizeColumn = (column: AnyColumn) =>
  sql`translate(lower(coalesce(${column}, '')), ${ACCENTS}, ${SANS_ACCENTS})`;

function normalize(saisie: string): string {
  return saisie.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Échappe les jokers de LIKE (%, _, \) d'une saisie. */
function contient(texte: string): string {
  return `%${texte.replace(/[\\%_]/g, "\\$&")}%`;
}

const digits = (v: string) => v.replace(/\D/g, "");
const phoneDigits = sql`regexp_replace(coalesce(${person.phone}, ''), '[^0-9]', '', 'g')`;

export { displayedName as nomAffiche };

// ---------------------------------------------------------------------------
// Recherche et liste
// ---------------------------------------------------------------------------

/**
 * Personnes liées, dans les deux sens, écrites avec les noms de tables : dans
 * un `select`, Drizzle n'écrit pas le nom de table devant `personne.id`.
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
  /** Noms des personnes liées, triés. */
  liees: string[];
};

/**
 * Recherche par nom, prénom, raison sociale, e-mail ou téléphone (chiffres
 * seuls, espaces ignorés). Insensible aux accents et à la casse.
 */
/**
 * Condition « la personne `alias` correspond à la saisie » : nom, prénom (dans
 * les deux ordres), raison sociale, e-mail, téléphone (chiffres seuls), sans
 * accents ni majuscules ; null si la saisie est trop courte.
 */
export function searchCondition(saisie: string, alias = "person"): SQL | null {
  const texte = normalize(saisie);
  if (texte.length < MINIMUM_LENGTH) return null;
  const pattern = contient(texte);
  const col = (c: string) =>
    sql`translate(lower(coalesce(${sql.identifier(alias)}.${sql.identifier(c)}, '')), ${ACCENTS}, ${SANS_ACCENTS})`;
  const conditions: SQL[] = [
    sql`${col("last_name")} LIKE ${pattern}`,
    sql`${col("first_name")} LIKE ${pattern}`,
    sql`${col("company_name")} LIKE ${pattern}`,
    sql`(${col("first_name")} || ' ' || ${col("last_name")}) LIKE ${pattern}`,
    sql`(${col("last_name")} || ' ' || ${col("first_name")}) LIKE ${pattern}`,
    sql`lower(coalesce(${sql.identifier(alias)}.email, '')) LIKE ${pattern}`,
  ];
  if (digits(texte).length >= 4) {
    conditions.push(
      sql`regexp_replace(coalesce(${sql.identifier(alias)}.phone, ''), '[^0-9]', '', 'g') LIKE ${contient(digits(texte))}`,
    );
  }
  return or(...conditions) ?? null;
}

/** Recherche dans toutes les personnes de l'école (voir conditionRecherche). */
export async function searchPeople(tx: Tx, saisie: string): Promise<PersonResult[]> {
  const condition = searchCondition(saisie);
  if (!condition) return [];
  return tx
    .select(resultColumns)
    .from(person)
    .where(condition)
    .orderBy(asc(person.lastName), asc(person.firstName))
    .limit(MAX_RESULTS);
}

/** Toutes les personnes de l'école, par nom (sans recherche saisie). */
export function listPeople(tx: Tx, limit = 200): Promise<PersonResult[]> {
  return tx.select(resultColumns).from(person).orderBy(asc(person.lastName), asc(person.firstName)).limit(limit);
}

// ---------------------------------------------------------------------------
// Fiche
// ---------------------------------------------------------------------------

export const RELATIONSHIP_TYPES = ["representant_legal", "conjoint", "autre"] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export type RelationshipItem = {
  id: string;
  /** L'autre personne du lien. */
  autre: { id: string; name: string; telephone: string | null; email: string | null };
  /** « de » : la personne de la fiche est <type> de l'autre ; « vers » : l'autre est <type> d'elle. */
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
  /** Cours suivis comme danseur, saison la plus récente d'abord. */
  courses: {
    id: string;
    season: string;
    discipline: string;
    level: string | null;
    weekday: number | null;
    startTime: string;
    status: (typeof enrollment.status.enumValues)[number];
    payerId: string;
    /** Appels faits pour ce danseur dans ce cours. */
    presents: number;
    absents: number;
  }[];
  documents: { type: (typeof studentDocument.type.enumValues)[number]; granted: boolean; validUntil: string | null }[];
};

/** Présences ou absences d'un danseur aux séances du cours de la ligne. */
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
 * Danseurs qu'un payeur peut inscrire : lui-même s'il est élève, et
 * les personnes pour qui il paie (lien « paie pour »). Par prénom.
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
        // Le payeur lui-même seulement s'il est élève : un parent qui paie n'est pas proposé à l'inscription.
        and(eq(person.id, payerId), eq(person.isStudent, true)),
        sql`EXISTS (SELECT 1 FROM relationship l WHERE l.person_id = ${payerId} AND l.related_person_id = ${currentId} AND l.pays_for)`,
      ),
    )
    .orderBy(asc(person.firstName), asc(person.lastName));
  return rows.map((l) => ({ ...l, firstName: l.firstName ?? l.name }));
}

/** Personnes qui paient pour un danseur (lien « paie pour »). */
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
// Écritures
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

/** Un professionnel sans contact nommé prend sa raison sociale comme nom ; pas de naissance pour lui. */
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

/** Personnes déjà connues avec le même téléphone, le même e-mail, les mêmes nom et prénom ou la même raison sociale. */
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

/** Annule la transaction de création quand le lien demandé est refusé. */
export class RelationshipRefusal extends Error {}

/**
 * Crée une personne, éventuellement liée d'emblée à une autre (`de` : qui est
 * <type> de qui ; « nouvelle » désigne la personne créée). Sans `confirme`,
 * renvoie d'abord les doublons probables.
 */
export async function createPerson(
  tx: Tx,
  saisie: PersonInput,
  confirmed: boolean,
  relationshipWith?: NewRelationship & { otherId: string; de: "nouvelle" | "autre" },
): Promise<{ status: "ok"; id: string } | { status: "doublons"; duplicates: Duplicate[] }> {
  if (!confirmed) {
    const duplicates = await likelyDuplicates(tx, saisie);
    if (duplicates.length > 0) return { status: "doublons", duplicates };
  }
  const [{ id }] = await tx
    .insert(person)
    .values({ ...personValues(saisie), schoolId: CURRENT_SCHOOL })
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

export async function updatePerson(tx: Tx, id: string, saisie: PersonInput): Promise<Result> {
  const refusal = { ok: false as const, message: "Cette personne n’existe plus." };
  if (!z.uuid().safeParse(id).success) return refusal;
  const rows = await tx.update(person).set(personValues(saisie)).where(eq(person.id, id)).returning({ id: person.id });
  return rows.length === 1 ? { ok: true, id } : refusal;
}

export const validRelationship = z.object({
  personId: z.uuid(),
  relatedPersonId: z.uuid(),
  type: z.enum(RELATIONSHIP_TYPES),
  emergencyContact: z.boolean(),
  paysFor: z.boolean(),
});

/** Lie deux personnes de l'école ; un seul lien par paire, quel que soit le sens. */
export async function addRelationship(tx: Tx, saisie: z.input<typeof validRelationship>): Promise<Result> {
  const l = validRelationship.safeParse(saisie);
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

/** Change le type ou les drapeaux d'un lien, sans en changer le sens. */
export async function updateRelationship(tx: Tx, id: string, saisie: NewRelationship): Promise<Result> {
  const refusal = { ok: false as const, message: "Ce lien n’existe plus." };
  if (!z.uuid().safeParse(id).success) return refusal;
  const rows = await tx
    .update(relationship)
    .set({ type: saisie.type, emergencyContact: saisie.emergencyContact, paysFor: saisie.paysFor })
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
