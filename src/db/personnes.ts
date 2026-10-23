import { type AnyColumn, and, asc, desc, eq, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { nomAffiche } from "../domaine/personnes/nom";
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

const LONGUEUR_MINIMALE = 2;
const RESULTATS_MAX = 50;
const ECOLE_COURANTE = sql`nullif(current_setting('app.school_id', true), '')::uuid`;

/** Minuscules sans accents, côté base (sans extension) et côté saisie. */
const ACCENTS = "àâäáãéèêëíìîïóòôöõúùûüçñ";
const SANS_ACCENTS = "aaaaaeeeeiiiiooooouuuucn";
const normaliserColonne = (colonne: AnyColumn) =>
  sql`translate(lower(coalesce(${colonne}, '')), ${ACCENTS}, ${SANS_ACCENTS})`;

function normaliser(saisie: string): string {
  return saisie.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Échappe les jokers de LIKE (%, _, \) d'une saisie. */
function contient(texte: string): string {
  return `%${texte.replace(/[\\%_]/g, "\\$&")}%`;
}

const chiffres = (v: string) => v.replace(/\D/g, "");
const telephoneEnChiffres = sql`regexp_replace(coalesce(${person.phone}, ''), '[^0-9]', '', 'g')`;

export { nomAffiche };

// ---------------------------------------------------------------------------
// Recherche et liste
// ---------------------------------------------------------------------------

/**
 * Personnes liées, dans les deux sens, écrites avec les noms de tables : dans
 * un `select`, Drizzle n'écrit pas le nom de table devant `personne.id`.
 */
const idCourant = sql`${person}.${sql.identifier("id")}`;
const liees = sql<string[]>`coalesce((
  SELECT array_agg(coalesce(a.company_name, concat_ws(' ', a.first_name, a.last_name)) ORDER BY a.first_name, a.last_name)
  FROM relationship l JOIN person a ON a.id = CASE WHEN l.person_id = ${idCourant} THEN l.related_person_id ELSE l.person_id END
  WHERE l.person_id = ${idCourant} OR l.related_person_id = ${idCourant}
), '{}')`;

const colonnesResultat = {
  id: person.id,
  type: person.type,
  nom: person.lastName,
  prenom: person.firstName,
  raisonSociale: person.companyName,
  dateNaissance: person.birthDate,
  email: person.email,
  telephone: person.phone,
  liees,
};

export type ResultatPersonne = {
  id: string;
  type: "particulier" | "professionnel";
  nom: string;
  prenom: string | null;
  raisonSociale: string | null;
  dateNaissance: string | null;
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
export function conditionRecherche(saisie: string, alias = "person"): SQL | null {
  const texte = normaliser(saisie);
  if (texte.length < LONGUEUR_MINIMALE) return null;
  const motif = contient(texte);
  const col = (c: string) =>
    sql`translate(lower(coalesce(${sql.identifier(alias)}.${sql.identifier(c)}, '')), ${ACCENTS}, ${SANS_ACCENTS})`;
  const conditions: SQL[] = [
    sql`${col("last_name")} LIKE ${motif}`,
    sql`${col("first_name")} LIKE ${motif}`,
    sql`${col("company_name")} LIKE ${motif}`,
    sql`(${col("first_name")} || ' ' || ${col("last_name")}) LIKE ${motif}`,
    sql`(${col("last_name")} || ' ' || ${col("first_name")}) LIKE ${motif}`,
    sql`lower(coalesce(${sql.identifier(alias)}.email, '')) LIKE ${motif}`,
  ];
  if (chiffres(texte).length >= 4) {
    conditions.push(
      sql`regexp_replace(coalesce(${sql.identifier(alias)}.phone, ''), '[^0-9]', '', 'g') LIKE ${contient(chiffres(texte))}`,
    );
  }
  return or(...conditions) ?? null;
}

/** Recherche dans toutes les personnes de l'école (voir conditionRecherche). */
export async function rechercherPersonnes(tx: Tx, saisie: string): Promise<ResultatPersonne[]> {
  const condition = conditionRecherche(saisie);
  if (!condition) return [];
  return tx
    .select(colonnesResultat)
    .from(person)
    .where(condition)
    .orderBy(asc(person.lastName), asc(person.firstName))
    .limit(RESULTATS_MAX);
}

/** Toutes les personnes de l'école, par nom (sans recherche saisie). */
export function listerPersonnes(tx: Tx, limite = 200): Promise<ResultatPersonne[]> {
  return tx.select(colonnesResultat).from(person).orderBy(asc(person.lastName), asc(person.firstName)).limit(limite);
}

// ---------------------------------------------------------------------------
// Fiche
// ---------------------------------------------------------------------------

export const TYPES_LIEN = ["representant_legal", "conjoint", "autre"] as const;
export type TypeLien = (typeof TYPES_LIEN)[number];

export type LienFiche = {
  id: string;
  /** L'autre personne du lien. */
  autre: { id: string; nom: string; telephone: string | null; email: string | null };
  /** « de » : la personne de la fiche est <type> de l'autre ; « vers » : l'autre est <type> d'elle. */
  sens: "de" | "vers";
  type: TypeLien;
  contactUrgence: boolean;
  paiePour: boolean;
};

export type FichePersonne = {
  id: string;
  type: "particulier" | "professionnel";
  nom: string;
  prenom: string | null;
  raisonSociale: string | null;
  siren: string | null;
  dateNaissance: string | null;
  email: string | null;
  telephone: string | null;
  adresse: string | null;
  notes: string | null;
  liens: LienFiche[];
  /** Cours suivis comme danseur, saison la plus récente d'abord. */
  cours: {
    id: string;
    saison: string;
    discipline: string;
    niveau: string | null;
    jourSemaine: number | null;
    heureDebut: string;
    statut: (typeof enrollment.status.enumValues)[number];
    payeurId: string;
    /** Appels faits pour ce danseur dans ce cours. */
    presents: number;
    absents: number;
  }[];
  documents: { type: (typeof studentDocument.type.enumValues)[number]; accorde: boolean; valideJusqu: string | null }[];
};

/** Présences ou absences d'un danseur aux séances du cours de la ligne. */
const presences = (danseurId: string, present: boolean) => sql<number>`(
  SELECT count(*)::int FROM attendance p JOIN lesson s ON s.id = p.lesson_id
  WHERE s.course_id = ${course}.${sql.identifier("id")} AND p.student_id = ${danseurId} AND p.present = ${present}
)`;

export async function lirePersonne(tx: Tx, id: string): Promise<FichePersonne | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [p] = await tx
    .select({
      id: person.id,
      type: person.type,
      nom: person.lastName,
      prenom: person.firstName,
      raisonSociale: person.companyName,
      siren: person.siren,
      dateNaissance: person.birthDate,
      email: person.email,
      telephone: person.phone,
      adresse: person.address,
      notes: person.notes,
    })
    .from(person)
    .where(eq(person.id, id));
  if (!p) return null;

  const autre = alias(person, "autre");
  const liens = await tx
    .select({
      id: relationship.id,
      personneId: relationship.personId,
      type: relationship.type,
      contactUrgence: relationship.emergencyContact,
      paiePour: relationship.paysFor,
      autreId: autre.id,
      nom: autre.lastName,
      prenom: autre.firstName,
      raisonSociale: autre.companyName,
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

  const suivis = await tx
    .select({
      id: course.id,
      saison: season.label,
      discipline: discipline.name,
      niveau: course.level,
      jourSemaine: course.weekday,
      heureDebut: course.startTime,
      statut: enrollment.status,
      payeurId: enrollment.payerId,
      presents: presences(id, true),
      absents: presences(id, false),
    })
    .from(enrollmentCourse)
    .innerJoin(enrollment, eq(enrollment.id, enrollmentCourse.enrollmentId))
    .innerJoin(course, eq(course.id, enrollmentCourse.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(season, eq(season.id, course.seasonId))
    .where(eq(enrollmentCourse.studentId, id))
    .orderBy(desc(season.startDate), sql`${course.weekday} NULLS LAST`, asc(course.startTime));

  const documents = await tx
    .select({ type: studentDocument.type, accorde: studentDocument.granted, valideJusqu: studentDocument.validUntil })
    .from(studentDocument)
    .where(eq(studentDocument.studentId, id))
    .orderBy(asc(studentDocument.type));

  return {
    ...p,
    liens: liens.map((l) => ({
      id: l.id,
      autre: { id: l.autreId, nom: nomAffiche(l), telephone: l.telephone, email: l.email },
      sens: l.personneId === id ? "de" : "vers",
      type: l.type,
      contactUrgence: l.contactUrgence,
      paiePour: l.paiePour,
    })),
    cours: suivis.map((c) => ({ ...c, heureDebut: c.heureDebut.slice(0, 5) })),
    documents,
  };
}

/**
 * Danseurs qu'un payeur peut inscrire : lui-même s'il est élève, et
 * les personnes pour qui il paie (lien « paie pour »). Par prénom.
 */
export async function danseursPayables(
  tx: Tx,
  payeurId: string,
): Promise<{ id: string; prenom: string; nom: string; dateNaissance: string | null }[]> {
  if (!z.uuid().safeParse(payeurId).success) return [];
  const lignes = await tx
    .select({ id: person.id, prenom: person.firstName, nom: person.lastName, dateNaissance: person.birthDate })
    .from(person)
    .where(
      or(
        // Le payeur lui-même seulement s'il est élève : un parent qui paie n'est pas proposé à l'inscription.
        and(eq(person.id, payeurId), eq(person.isStudent, true)),
        sql`EXISTS (SELECT 1 FROM relationship l WHERE l.person_id = ${payeurId} AND l.related_person_id = ${idCourant} AND l.pays_for)`,
      ),
    )
    .orderBy(asc(person.firstName), asc(person.lastName));
  return lignes.map((l) => ({ ...l, prenom: l.prenom ?? l.nom }));
}

/** Personnes qui paient pour un danseur (lien « paie pour »). */
export async function payeursDe(tx: Tx, danseurId: string): Promise<{ id: string; nom: string }[]> {
  if (!z.uuid().safeParse(danseurId).success) return [];
  const payeurs = await tx
    .select({ id: person.id, nom: person.lastName, prenom: person.firstName, raisonSociale: person.companyName })
    .from(relationship)
    .innerJoin(person, eq(person.id, relationship.personId))
    .where(and(eq(relationship.relatedPersonId, danseurId), eq(relationship.paysFor, true)))
    .orderBy(asc(person.lastName));
  return payeurs.map((p) => ({ id: p.id, nom: nomAffiche(p) }));
}

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------

const texteFacultatif = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

export const saisiePersonneValide = z
  .object({
    type: z.enum(["particulier", "professionnel"]),
    nom: z.string().trim().max(100),
    prenom: texteFacultatif(100),
    raisonSociale: texteFacultatif(200),
    siren: z
      .string()
      .nullable()
      .transform((v) => (v ?? "").replace(/\s/g, "") || null)
      .refine((v) => v === null || /^\d{9}$/.test(v), "Le SIREN compte 9 chiffres"),
    dateNaissance: z
      .union([z.literal(""), z.iso.date("Date invalide")])
      .nullable()
      .transform((v) => v || null),
    email: z
      .union([z.literal(""), z.email("E-mail invalide")])
      .nullable()
      .transform((v) => v || null),
    telephone: texteFacultatif(30),
    adresse: texteFacultatif(300),
    notes: texteFacultatif(2000),
  })
  .superRefine((f, ctx) => {
    if (f.type === "particulier" && !f.nom) ctx.addIssue({ code: "custom", path: ["nom"], message: "Nom obligatoire" });
    if (f.type === "professionnel" && !f.raisonSociale)
      ctx.addIssue({ code: "custom", path: ["raisonSociale"], message: "Raison sociale obligatoire" });
    if (f.type === "professionnel" && !f.siren)
      ctx.addIssue({ code: "custom", path: ["siren"], message: "SIREN obligatoire pour un professionnel" });
  });

export type SaisiePersonne = z.output<typeof saisiePersonneValide>;
export type Doublon = { id: string; nom: string; telephone: string | null };
export type Resultat = { ok: true; id: string } | { ok: false; message: string };

/** Un professionnel sans contact nommé prend sa raison sociale comme nom ; pas de naissance pour lui. */
const valeursPersonne = (f: SaisiePersonne) => ({
  type: f.type,
  lastName: f.nom || f.raisonSociale || "",
  firstName: f.type === "particulier" ? f.prenom : null,
  companyName: f.type === "professionnel" ? f.raisonSociale : null,
  siren: f.type === "professionnel" ? f.siren : null,
  birthDate: f.type === "particulier" ? f.dateNaissance : null,
  email: f.email,
  phone: f.telephone,
  address: f.adresse,
  notes: f.notes,
});

/** Personnes déjà connues avec le même téléphone, le même e-mail, les mêmes nom et prénom ou la même raison sociale. */
export async function doublonsProbables(tx: Tx, f: SaisiePersonne): Promise<Doublon[]> {
  const conditions: SQL[] = [];
  if (f.telephone && chiffres(f.telephone).length >= 6)
    conditions.push(sql`${telephoneEnChiffres} = ${chiffres(f.telephone)}`);
  if (f.email) conditions.push(sql`lower(${person.email}) = lower(${f.email})`);
  if (f.type === "particulier" && f.prenom)
    conditions.push(
      sql`${normaliserColonne(person.lastName)} = ${normaliser(f.nom)} AND ${normaliserColonne(person.firstName)} = ${normaliser(f.prenom)}`,
    );
  if (f.raisonSociale) conditions.push(sql`${normaliserColonne(person.companyName)} = ${normaliser(f.raisonSociale)}`);
  if (conditions.length === 0) return [];
  const lignes = await tx
    .select({
      id: person.id,
      nom: person.lastName,
      prenom: person.firstName,
      raisonSociale: person.companyName,
      telephone: person.phone,
    })
    .from(person)
    .where(or(...conditions))
    .orderBy(asc(person.lastName))
    .limit(5);
  return lignes.map((l) => ({ id: l.id, nom: nomAffiche(l), telephone: l.telephone }));
}

export type NouveauLien = { type: TypeLien; contactUrgence: boolean; paiePour: boolean };

/** Annule la transaction de création quand le lien demandé est refusé. */
export class RefusLien extends Error {}

/**
 * Crée une personne, éventuellement liée d'emblée à une autre (`de` : qui est
 * <type> de qui ; « nouvelle » désigne la personne créée). Sans `confirme`,
 * renvoie d'abord les doublons probables.
 */
export async function creerPersonne(
  tx: Tx,
  saisie: SaisiePersonne,
  confirme: boolean,
  lienAvec?: NouveauLien & { autreId: string; de: "nouvelle" | "autre" },
): Promise<{ statut: "ok"; id: string } | { statut: "doublons"; doublons: Doublon[] }> {
  if (!confirme) {
    const doublons = await doublonsProbables(tx, saisie);
    if (doublons.length > 0) return { statut: "doublons", doublons };
  }
  const [{ id }] = await tx
    .insert(person)
    .values({ ...valeursPersonne(saisie), schoolId: ECOLE_COURANTE })
    .returning({ id: person.id });
  if (lienAvec) {
    const { autreId, de, ...l } = lienAvec;
    const r = await ajouterLien(
      tx,
      de === "nouvelle" ? { ...l, personneId: id, lieAId: autreId } : { ...l, personneId: autreId, lieAId: id },
    );
    if (!r.ok) throw new RefusLien(r.message);
  }
  return { statut: "ok", id };
}

export async function modifierPersonne(tx: Tx, id: string, saisie: SaisiePersonne): Promise<Resultat> {
  const refus = { ok: false as const, message: "Cette personne n’existe plus." };
  if (!z.uuid().safeParse(id).success) return refus;
  const lignes = await tx
    .update(person)
    .set(valeursPersonne(saisie))
    .where(eq(person.id, id))
    .returning({ id: person.id });
  return lignes.length === 1 ? { ok: true, id } : refus;
}

export const lienValide = z.object({
  personneId: z.uuid(),
  lieAId: z.uuid(),
  type: z.enum(TYPES_LIEN),
  contactUrgence: z.boolean(),
  paiePour: z.boolean(),
});

/** Lie deux personnes de l'école ; un seul lien par paire, quel que soit le sens. */
export async function ajouterLien(tx: Tx, saisie: z.input<typeof lienValide>): Promise<Resultat> {
  const l = lienValide.safeParse(saisie);
  if (!l.success) return { ok: false, message: "Lien invalide." };
  const { personneId, lieAId } = l.data;
  if (personneId === lieAId) return { ok: false, message: "Une personne ne peut pas être liée à elle-même." };
  const presentes = await tx
    .select({ id: person.id })
    .from(person)
    .where(or(eq(person.id, personneId), eq(person.id, lieAId)));
  if (presentes.length !== 2) return { ok: false, message: "Personne introuvable." };
  const [existant] = await tx
    .select({ id: relationship.id })
    .from(relationship)
    .where(
      or(
        and(eq(relationship.personId, personneId), eq(relationship.relatedPersonId, lieAId)),
        and(eq(relationship.personId, lieAId), eq(relationship.relatedPersonId, personneId)),
      ),
    );
  if (existant) return { ok: false, message: "Ces deux personnes sont déjà liées." };
  const [{ id }] = await tx
    .insert(relationship)
    .values({
      personId: l.data.personneId,
      relatedPersonId: l.data.lieAId,
      type: l.data.type,
      emergencyContact: l.data.contactUrgence,
      paysFor: l.data.paiePour,
      schoolId: ECOLE_COURANTE,
    })
    .returning({ id: relationship.id });
  return { ok: true, id };
}

/** Change le type ou les drapeaux d'un lien, sans en changer le sens. */
export async function modifierLien(tx: Tx, id: string, saisie: NouveauLien): Promise<Resultat> {
  const refus = { ok: false as const, message: "Ce lien n’existe plus." };
  if (!z.uuid().safeParse(id).success) return refus;
  const lignes = await tx
    .update(relationship)
    .set({ type: saisie.type, emergencyContact: saisie.contactUrgence, paysFor: saisie.paiePour })
    .where(eq(relationship.id, id))
    .returning({ id: relationship.id });
  return lignes.length === 1 ? { ok: true, id } : refus;
}

export async function supprimerLien(tx: Tx, id: string): Promise<Resultat> {
  const refus = { ok: false as const, message: "Ce lien n’existe plus." };
  if (!z.uuid().safeParse(id).success) return refus;
  const lignes = await tx.delete(relationship).where(eq(relationship.id, id)).returning({ id: relationship.id });
  return lignes.length === 1 ? { ok: true, id } : refus;
}
