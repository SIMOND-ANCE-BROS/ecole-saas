import { type AnyColumn, asc, eq, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./index";
import { danseur, payeur } from "./schema";

/**
 * Lectures des familles (payeurs et danseurs). Toujours appelées avec la
 * transaction de `avecEcole()` : la RLS limite les résultats à l'école courante.
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
