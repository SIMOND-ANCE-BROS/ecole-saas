import { type AnyColumn, and, asc, desc, eq, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { nomAffiche } from "../domaine/personnes/nom";
import type { Tx } from "./index";
import { cours, discipline, documentDanseur, inscription, inscriptionCours, lien, personne, saison } from "./schema";

/**
 * Personnes (danseurs, parents, conjoints, payeurs professionnels) et liens
 * entre elles. Toujours avec la transaction de `avecEcole()` : la RLS limite
 * lectures et écritures à l'école courante.
 */

const LONGUEUR_MINIMALE = 2;
const RESULTATS_MAX = 50;
const ECOLE_COURANTE = sql`nullif(current_setting('app.ecole_id', true), '')::uuid`;

/** Minuscules sans accents, côté base (sans extension) et côté saisie. */
const ACCENTS = "àâäáãéèêëíìîïóòôöõúùûüçñ";
const SANS_ACCENTS = "aaaaaeeeeiiiiooooouuuucn";
const normaliserColonne = (colonne: AnyColumn) => sql`translate(lower(coalesce(${colonne}, '')), ${ACCENTS}, ${SANS_ACCENTS})`;

function normaliser(saisie: string): string {
  return saisie
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Échappe les jokers de LIKE (%, _, \) d'une saisie. */
function contient(texte: string): string {
  return `%${texte.replace(/[\\%_]/g, "\\$&")}%`;
}

const chiffres = (v: string) => v.replace(/\D/g, "");
const telephoneEnChiffres = sql`regexp_replace(coalesce(${personne.telephone}, ''), '[^0-9]', '', 'g')`;

export { nomAffiche };

// ---------------------------------------------------------------------------
// Recherche et liste
// ---------------------------------------------------------------------------

/**
 * Personnes liées, dans les deux sens, écrites avec les noms de tables : dans
 * un `select`, Drizzle n'écrit pas le nom de table devant `personne.id`.
 */
const idCourant = sql`${personne}.${sql.identifier("id")}`;
const liees = sql<string[]>`coalesce((
  SELECT array_agg(coalesce(a.raison_sociale, concat_ws(' ', a.prenom, a.nom)) ORDER BY a.prenom, a.nom)
  FROM lien l JOIN personne a ON a.id = CASE WHEN l.personne_id = ${idCourant} THEN l.lie_a_id ELSE l.personne_id END
  WHERE l.personne_id = ${idCourant} OR l.lie_a_id = ${idCourant}
), '{}')`;

const colonnesResultat = {
  id: personne.id,
  type: personne.type,
  nom: personne.nom,
  prenom: personne.prenom,
  raisonSociale: personne.raisonSociale,
  dateNaissance: personne.dateNaissance,
  email: personne.email,
  telephone: personne.telephone,
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
export async function rechercherPersonnes(tx: Tx, saisie: string): Promise<ResultatPersonne[]> {
  const texte = normaliser(saisie);
  if (texte.length < LONGUEUR_MINIMALE) return [];
  const motif = contient(texte);
  const conditions: SQL[] = [
    sql`${normaliserColonne(personne.nom)} LIKE ${motif}`,
    sql`${normaliserColonne(personne.prenom)} LIKE ${motif}`,
    sql`${normaliserColonne(personne.raisonSociale)} LIKE ${motif}`,
    sql`(${normaliserColonne(personne.prenom)} || ' ' || ${normaliserColonne(personne.nom)}) LIKE ${motif}`,
    sql`(${normaliserColonne(personne.nom)} || ' ' || ${normaliserColonne(personne.prenom)}) LIKE ${motif}`,
    sql`lower(coalesce(${personne.email}, '')) LIKE ${motif}`,
  ];
  if (chiffres(texte).length >= 4) conditions.push(sql`${telephoneEnChiffres} LIKE ${contient(chiffres(texte))}`);

  return tx
    .select(colonnesResultat)
    .from(personne)
    .where(or(...conditions))
    .orderBy(asc(personne.nom), asc(personne.prenom))
    .limit(RESULTATS_MAX);
}

/** Toutes les personnes de l'école, par nom (sans recherche saisie). */
export function listerPersonnes(tx: Tx, limite = 200): Promise<ResultatPersonne[]> {
  return tx.select(colonnesResultat).from(personne).orderBy(asc(personne.nom), asc(personne.prenom)).limit(limite);
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
    statut: (typeof inscription.statut.enumValues)[number];
    payeurId: string;
    /** Appels faits pour ce danseur dans ce cours. */
    presents: number;
    absents: number;
  }[];
  documents: { type: (typeof documentDanseur.type.enumValues)[number]; accorde: boolean; valideJusqu: string | null }[];
};

/** Présences ou absences d'un danseur aux séances du cours de la ligne. */
const presences = (danseurId: string, present: boolean) => sql<number>`(
  SELECT count(*)::int FROM presence p JOIN seance s ON s.id = p.seance_id
  WHERE s.cours_id = ${cours}.${sql.identifier("id")} AND p.danseur_id = ${danseurId} AND p.present = ${present}
)`;

export async function lirePersonne(tx: Tx, id: string): Promise<FichePersonne | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [p] = await tx
    .select({
      id: personne.id,
      type: personne.type,
      nom: personne.nom,
      prenom: personne.prenom,
      raisonSociale: personne.raisonSociale,
      siren: personne.siren,
      dateNaissance: personne.dateNaissance,
      email: personne.email,
      telephone: personne.telephone,
      adresse: personne.adresse,
      notes: personne.notes,
    })
    .from(personne)
    .where(eq(personne.id, id));
  if (!p) return null;

  const autre = alias(personne, "autre");
  const liens = await tx
    .select({
      id: lien.id,
      personneId: lien.personneId,
      type: lien.type,
      contactUrgence: lien.contactUrgence,
      paiePour: lien.paiePour,
      autreId: autre.id,
      nom: autre.nom,
      prenom: autre.prenom,
      raisonSociale: autre.raisonSociale,
      telephone: autre.telephone,
      email: autre.email,
    })
    .from(lien)
    .innerJoin(autre, sql`${autre.id} = CASE WHEN ${lien.personneId} = ${id} THEN ${lien.lieAId} ELSE ${lien.personneId} END`)
    .where(or(eq(lien.personneId, id), eq(lien.lieAId, id)))
    .orderBy(asc(autre.prenom), asc(autre.nom));

  const suivis = await tx
    .select({
      id: cours.id,
      saison: saison.libelle,
      discipline: discipline.nom,
      niveau: cours.niveau,
      jourSemaine: cours.jourSemaine,
      heureDebut: cours.heureDebut,
      statut: inscription.statut,
      payeurId: inscription.payeurId,
      presents: presences(id, true),
      absents: presences(id, false),
    })
    .from(inscriptionCours)
    .innerJoin(inscription, eq(inscription.id, inscriptionCours.inscriptionId))
    .innerJoin(cours, eq(cours.id, inscriptionCours.coursId))
    .innerJoin(discipline, eq(discipline.id, cours.disciplineId))
    .innerJoin(saison, eq(saison.id, cours.saisonId))
    .where(eq(inscriptionCours.danseurId, id))
    .orderBy(desc(saison.dateDebut), sql`${cours.jourSemaine} NULLS LAST`, asc(cours.heureDebut));

  const documents = await tx
    .select({ type: documentDanseur.type, accorde: documentDanseur.accorde, valideJusqu: documentDanseur.valideJusqu })
    .from(documentDanseur)
    .where(eq(documentDanseur.danseurId, id))
    .orderBy(asc(documentDanseur.type));

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
 * Danseurs qu'un payeur peut inscrire : lui-même s'il est un particulier, et
 * les personnes pour qui il paie (lien « paie pour »). Par prénom.
 */
export async function danseursPayables(
  tx: Tx,
  payeurId: string,
): Promise<{ id: string; prenom: string; nom: string; dateNaissance: string | null }[]> {
  if (!z.uuid().safeParse(payeurId).success) return [];
  const lignes = await tx
    .select({ id: personne.id, prenom: personne.prenom, nom: personne.nom, dateNaissance: personne.dateNaissance })
    .from(personne)
    .where(
      or(
        and(eq(personne.id, payeurId), eq(personne.type, "particulier")),
        sql`EXISTS (SELECT 1 FROM lien l WHERE l.personne_id = ${payeurId} AND l.lie_a_id = ${idCourant} AND l.paie_pour)`,
      ),
    )
    .orderBy(asc(personne.prenom), asc(personne.nom));
  return lignes.map((l) => ({ ...l, prenom: l.prenom ?? l.nom }));
}

/** Personnes qui paient pour un danseur (lien « paie pour »). */
export async function payeursDe(tx: Tx, danseurId: string): Promise<{ id: string; nom: string }[]> {
  if (!z.uuid().safeParse(danseurId).success) return [];
  const payeurs = await tx
    .select({ id: personne.id, nom: personne.nom, prenom: personne.prenom, raisonSociale: personne.raisonSociale })
    .from(lien)
    .innerJoin(personne, eq(personne.id, lien.personneId))
    .where(and(eq(lien.lieAId, danseurId), eq(lien.paiePour, true)))
    .orderBy(asc(personne.nom));
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
  ...f,
  nom: f.nom || f.raisonSociale || "",
  prenom: f.type === "particulier" ? f.prenom : null,
  raisonSociale: f.type === "professionnel" ? f.raisonSociale : null,
  siren: f.type === "professionnel" ? f.siren : null,
  dateNaissance: f.type === "particulier" ? f.dateNaissance : null,
});

/** Personnes déjà connues avec le même téléphone, le même e-mail, les mêmes nom et prénom ou la même raison sociale. */
async function doublonsProbables(tx: Tx, f: SaisiePersonne): Promise<Doublon[]> {
  const conditions: SQL[] = [];
  if (f.telephone && chiffres(f.telephone).length >= 6) conditions.push(sql`${telephoneEnChiffres} = ${chiffres(f.telephone)}`);
  if (f.email) conditions.push(sql`lower(${personne.email}) = lower(${f.email})`);
  if (f.type === "particulier" && f.prenom)
    conditions.push(
      sql`${normaliserColonne(personne.nom)} = ${normaliser(f.nom)} AND ${normaliserColonne(personne.prenom)} = ${normaliser(f.prenom)}`,
    );
  if (f.raisonSociale) conditions.push(sql`${normaliserColonne(personne.raisonSociale)} = ${normaliser(f.raisonSociale)}`);
  if (conditions.length === 0) return [];
  const lignes = await tx
    .select({ id: personne.id, nom: personne.nom, prenom: personne.prenom, raisonSociale: personne.raisonSociale, telephone: personne.telephone })
    .from(personne)
    .where(or(...conditions))
    .orderBy(asc(personne.nom))
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
    .insert(personne)
    .values({ ...valeursPersonne(saisie), ecoleId: ECOLE_COURANTE })
    .returning({ id: personne.id });
  if (lienAvec) {
    const { autreId, de, ...l } = lienAvec;
    const r = await ajouterLien(tx, de === "nouvelle" ? { ...l, personneId: id, lieAId: autreId } : { ...l, personneId: autreId, lieAId: id });
    if (!r.ok) throw new RefusLien(r.message);
  }
  return { statut: "ok", id };
}

export async function modifierPersonne(tx: Tx, id: string, saisie: SaisiePersonne): Promise<Resultat> {
  const refus = { ok: false as const, message: "Cette personne n’existe plus." };
  if (!z.uuid().safeParse(id).success) return refus;
  const lignes = await tx.update(personne).set(valeursPersonne(saisie)).where(eq(personne.id, id)).returning({ id: personne.id });
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
  const presentes = await tx.select({ id: personne.id }).from(personne).where(or(eq(personne.id, personneId), eq(personne.id, lieAId)));
  if (presentes.length !== 2) return { ok: false, message: "Personne introuvable." };
  const [existant] = await tx
    .select({ id: lien.id })
    .from(lien)
    .where(
      or(and(eq(lien.personneId, personneId), eq(lien.lieAId, lieAId)), and(eq(lien.personneId, lieAId), eq(lien.lieAId, personneId))),
    );
  if (existant) return { ok: false, message: "Ces deux personnes sont déjà liées." };
  const [{ id }] = await tx.insert(lien).values({ ...l.data, ecoleId: ECOLE_COURANTE }).returning({ id: lien.id });
  return { ok: true, id };
}

/** Change le type ou les drapeaux d'un lien, sans en changer le sens. */
export async function modifierLien(tx: Tx, id: string, saisie: NouveauLien): Promise<Resultat> {
  const refus = { ok: false as const, message: "Ce lien n’existe plus." };
  if (!z.uuid().safeParse(id).success) return refus;
  const lignes = await tx.update(lien).set(saisie).where(eq(lien.id, id)).returning({ id: lien.id });
  return lignes.length === 1 ? { ok: true, id } : refus;
}

export async function supprimerLien(tx: Tx, id: string): Promise<Resultat> {
  const refus = { ok: false as const, message: "Ce lien n’existe plus." };
  if (!z.uuid().safeParse(id).success) return refus;
  const lignes = await tx.delete(lien).where(eq(lien.id, id)).returning({ id: lien.id });
  return lignes.length === 1 ? { ok: true, id } : refus;
}
