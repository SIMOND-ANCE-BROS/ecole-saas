import { type AnyColumn, asc, eq, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./index";
import { danseur, payeur } from "./schema";

/**
 * Familles (payeurs et danseurs). Toujours appelées avec la transaction de
 * `avecEcole()` : la RLS limite lectures et écritures à l'école courante.
 */

const LONGUEUR_MINIMALE = 2;
const RESULTATS_MAX = 50;

/** Minuscules sans accents, côté base (sans extension) et côté saisie. */
const ACCENTS = "àâäáãéèêëíìîïóòôöõúùûüçñ";
const SANS_ACCENTS = "aaaaaeeeeiiiiooooouuuucn";
const normaliserColonne = (colonne: AnyColumn) =>
  sql`translate(lower(coalesce(${colonne}, '')), ${ACCENTS}, ${SANS_ACCENTS})`;

function normaliser(saisie: string): string {
  return saisie
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Corrélation danseur → payeur écrite avec les noms de tables : dans un
 * `select`, Drizzle n'écrit pas le nom de table devant `payeur.id`, qui
 * désignerait alors l'id du danseur dans la sous-requête.
 */
const danseurDuPayeur = sql`${danseur}.${sql.identifier("payeur_id")} = ${payeur}.${sql.identifier("id")}`;

/** Échappe les jokers de LIKE (%, _, \) d'une saisie. */
function contient(texte: string): string {
  return `%${texte.replace(/[\\%_]/g, "\\$&")}%`;
}

const colonnesFamille = {
  id: payeur.id,
  nom: payeur.nom,
  prenom: payeur.prenom,
  raisonSociale: payeur.raisonSociale,
  email: payeur.email,
  telephone: payeur.telephone,
  danseurs: sql<string[]>`coalesce((SELECT array_agg(${danseur.prenom} ORDER BY ${danseur.prenom})
      FROM ${danseur} WHERE ${danseurDuPayeur}), '{}')`,
};

export type ResultatFamille = {
  id: string;
  nom: string;
  prenom: string | null;
  raisonSociale: string | null;
  email: string | null;
  telephone: string | null;
  /** Prénoms des danseurs rattachés, triés. */
  danseurs: string[];
};

/**
 * Recherche par nom ou prénom du payeur, nom ou prénom d'un danseur, e-mail ou
 * téléphone (chiffres seuls, espaces ignorés). Insensible aux accents et à la casse.
 */
export async function rechercherFamilles(tx: Tx, saisie: string): Promise<ResultatFamille[]> {
  const texte = normaliser(saisie);
  if (texte.length < LONGUEUR_MINIMALE) return [];
  const motif = contient(texte);
  const chiffres = texte.replace(/\D/g, "");

  const conditions: SQL[] = [
    sql`${normaliserColonne(payeur.nom)} LIKE ${motif}`,
    sql`${normaliserColonne(payeur.prenom)} LIKE ${motif}`,
    sql`${normaliserColonne(payeur.raisonSociale)} LIKE ${motif}`,
    sql`lower(coalesce(${payeur.email}, '')) LIKE ${motif}`,
    sql`EXISTS (SELECT 1 FROM ${danseur} WHERE ${danseurDuPayeur}
          AND (${normaliserColonne(danseur.prenom)} LIKE ${motif} OR ${normaliserColonne(danseur.nom)} LIKE ${motif}))`,
  ];
  if (chiffres.length >= 4) {
    conditions.push(sql`regexp_replace(coalesce(${payeur.telephone}, ''), '\\D', '', 'g') LIKE ${contient(chiffres)}`);
  }

  return tx
    .select(colonnesFamille)
    .from(payeur)
    .where(or(...conditions))
    .orderBy(asc(payeur.nom), asc(payeur.prenom))
    .limit(RESULTATS_MAX);
}

/** Toutes les familles de l'école, par nom (sans recherche saisie). */
export async function listerFamilles(tx: Tx, limite = 200): Promise<ResultatFamille[]> {
  return tx.select(colonnesFamille).from(payeur).orderBy(asc(payeur.nom), asc(payeur.prenom)).limit(limite);
}

export type Famille = {
  id: string;
  type: "particulier" | "professionnel";
  nom: string;
  prenom: string | null;
  raisonSociale: string | null;
  siren: string | null;
  email: string | null;
  telephone: string | null;
  adresse: string | null;
  danseurs: { id: string; nom: string; prenom: string; dateNaissance: string | null }[];
};

/** Fiche d'un payeur et de ses danseurs ; null si absente de l'école courante. */
export async function lireFamille(tx: Tx, id: string): Promise<Famille | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [p] = await tx
    .select({
      id: payeur.id,
      type: payeur.type,
      nom: payeur.nom,
      prenom: payeur.prenom,
      raisonSociale: payeur.raisonSociale,
      siren: payeur.siren,
      email: payeur.email,
      telephone: payeur.telephone,
      adresse: payeur.adresse,
    })
    .from(payeur)
    .where(eq(payeur.id, id));
  if (!p) return null;
  const danseurs = await tx
    .select({ id: danseur.id, nom: danseur.nom, prenom: danseur.prenom, dateNaissance: danseur.dateNaissance })
    .from(danseur)
    .where(eq(danseur.payeurId, id))
    .orderBy(asc(danseur.prenom));
  return { ...p, danseurs };
}

const texteFacultatif = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

export const saisieFamilleValide = z
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
    email: z
      .union([z.literal(""), z.email("E-mail invalide")])
      .nullable()
      .transform((v) => v || null),
    telephone: texteFacultatif(30),
    adresse: texteFacultatif(300),
  })
  .superRefine((f, ctx) => {
    if (f.type === "particulier" && !f.nom) ctx.addIssue({ code: "custom", path: ["nom"], message: "Nom obligatoire" });
    if (f.type === "professionnel" && !f.raisonSociale)
      ctx.addIssue({ code: "custom", path: ["raisonSociale"], message: "Raison sociale obligatoire" });
    if (f.type === "professionnel" && !f.siren)
      ctx.addIssue({ code: "custom", path: ["siren"], message: "SIREN obligatoire pour un professionnel" });
  });

export type SaisieFamille = z.output<typeof saisieFamilleValide>;
export type PremierDanseur = { prenom: string; dateNaissance: string | null };
export type Doublon = { id: string; nom: string; prenom: string | null; raisonSociale: string | null; telephone: string | null };

const ECOLE_COURANTE = sql`nullif(current_setting('app.ecole_id', true), '')::uuid`;
const chiffres = (v: string) => v.replace(/\D/g, "");

/** Un professionnel sans contact nommé prend sa raison sociale comme nom. */
const valeursPayeur = (f: SaisieFamille) => ({
  ...f,
  nom: f.nom || f.raisonSociale || "",
  prenom: f.type === "particulier" ? f.prenom : null,
});

/** Familles déjà connues avec le même téléphone, le même e-mail ou les mêmes nom et prénom. */
async function doublonsProbables(tx: Tx, f: SaisieFamille): Promise<Doublon[]> {
  const conditions: SQL[] = [];
  if (f.telephone && chiffres(f.telephone).length >= 6)
    conditions.push(sql`regexp_replace(coalesce(${payeur.telephone}, ''), '[^0-9]', '', 'g') = ${chiffres(f.telephone)}`);
  if (f.email) conditions.push(sql`lower(${payeur.email}) = lower(${f.email})`);
  if (f.type === "particulier" && f.prenom)
    conditions.push(sql`${normaliserColonne(payeur.nom)} = ${normaliser(f.nom)} AND ${normaliserColonne(payeur.prenom)} = ${normaliser(f.prenom)}`);
  if (f.raisonSociale) conditions.push(sql`${normaliserColonne(payeur.raisonSociale)} = ${normaliser(f.raisonSociale)}`);
  if (conditions.length === 0) return [];
  return tx
    .select({ id: payeur.id, nom: payeur.nom, prenom: payeur.prenom, raisonSociale: payeur.raisonSociale, telephone: payeur.telephone })
    .from(payeur)
    .where(or(...conditions))
    .orderBy(asc(payeur.nom))
    .limit(5);
}

/**
 * Crée une famille et, s'il est donné, son premier danseur (même nom pour un
 * particulier). Sans `confirme`, renvoie d'abord les doublons probables.
 */
export async function creerFamille(
  tx: Tx,
  saisie: SaisieFamille,
  premier: PremierDanseur | null,
  confirme: boolean,
): Promise<{ statut: "ok"; id: string } | { statut: "doublons"; doublons: Doublon[] }> {
  if (!confirme) {
    const doublons = await doublonsProbables(tx, saisie);
    if (doublons.length > 0) return { statut: "doublons", doublons };
  }
  const valeurs = valeursPayeur(saisie);
  const [{ id }] = await tx.insert(payeur).values({ ...valeurs, ecoleId: ECOLE_COURANTE }).returning({ id: payeur.id });
  if (premier) {
    await tx.insert(danseur).values({
      ecoleId: ECOLE_COURANTE,
      payeurId: id,
      nom: valeurs.nom,
      prenom: premier.prenom,
      dateNaissance: premier.dateNaissance,
    });
  }
  return { statut: "ok", id };
}

export async function modifierFamille(
  tx: Tx,
  id: string,
  saisie: SaisieFamille,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const refus = { ok: false as const, message: "Cette famille n’existe plus." };
  if (!z.uuid().safeParse(id).success) return refus;
  const lignes = await tx.update(payeur).set(valeursPayeur(saisie)).where(eq(payeur.id, id)).returning({ id: payeur.id });
  return lignes.length === 1 ? { ok: true, id } : refus;
}
