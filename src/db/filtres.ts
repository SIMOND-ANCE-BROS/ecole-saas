import { and, or, type SQL, sql } from "drizzle-orm";
import {
  ACCENTS,
  type Condition,
  type DefColonne,
  type Filtre,
  SANS_ACCENTS,
  SEPARATEUR,
  VIDE,
  type Tri,
  valeurNormalisee,
} from "../domaine/filtres/filtres";

/**
 * Traduction SQL des filtres par colonne (`src/domaine/filtres/filtres.ts`),
 * avec les mêmes règles que l'évaluation en mémoire : accents et majuscules
 * ignorés, chiffres seuls pour un téléphone, une valeur absente compte comme
 * vide. Les valeurs passent en paramètres, jamais dans le texte SQL.
 */

/** Expression SQL d'une colonne ; `liste` : un tableau de textes (responsables…). */
export type ExpressionColonne = { sql: SQL; liste?: boolean };

const normaliser = (x: SQL) =>
  sql`regexp_replace(btrim(translate(lower(${x}), ${ACCENTS}, ${SANS_ACCENTS})), '\\s+', ' ', 'g')`;

function condition(c: Condition, def: DefColonne, e: ExpressionColonne): SQL | undefined {
  const v = valeurNormalisee(c, def.type);
  if (v === null) return undefined;

  if (def.type === "nombre") {
    const n = sql`(${e.sql})::numeric`;
    switch (c.operateur) {
      case "vide":
        return sql`${n} IS NULL`;
      case "non_vide":
        return sql`${n} IS NOT NULL`;
      case "egal":
        return sql`${n} = ${v}::numeric`;
      case "different":
        return sql`${n} IS DISTINCT FROM ${v}::numeric`;
      case "sup":
        return sql`${n} > ${v}::numeric`;
      case "sup_egal":
        return sql`${n} >= ${v}::numeric`;
      case "inf":
        return sql`${n} < ${v}::numeric`;
      case "inf_egal":
        return sql`${n} <= ${v}::numeric`;
      default:
        return undefined;
    }
  }

  if (def.type === "date") {
    const d = sql`(${e.sql})::date`;
    switch (c.operateur) {
      case "vide":
        return sql`${d} IS NULL`;
      case "non_vide":
        return sql`${d} IS NOT NULL`;
      case "egal":
        return sql`${d} = ${v}::date`;
      case "inf_egal":
        return sql`${d} <= ${v}::date`;
      case "sup_egal":
        return sql`${d} >= ${v}::date`;
      case "inf":
        return sql`${d} < ${v}::date`;
      case "sup":
        return sql`${d} > ${v}::date`;
      default:
        return undefined;
    }
  }

  const brut = e.liste ? sql`array_to_string(${e.sql}, ', ')` : sql`(${e.sql})::text`;
  const t =
    def.type === "telephone"
      ? sql`regexp_replace(coalesce(${brut}, ''), '[^0-9]', '', 'g')`
      : normaliser(sql`coalesce(${brut}, '')`);
  // Une liste « est » X si l'un de ses éléments vaut X.
  const unElement = sql`EXISTS (SELECT 1 FROM unnest(${e.sql}) AS element WHERE ${normaliser(sql`element`)} = ${v})`;
  switch (c.operateur) {
    case "vide":
      return sql`${t} = ''`;
    case "non_vide":
      return sql`${t} <> ''`;
    case "contient":
      return sql`strpos(${t}, ${v}) > 0`;
    case "ne_contient_pas":
      return sql`strpos(${t}, ${v}) = 0`;
    case "commence":
      return sql`starts_with(${t}, ${v})`;
    case "est":
      return e.liste ? unElement : sql`${t} = ${v}`;
    case "n_est_pas":
      return e.liste ? sql`NOT ${unElement}` : sql`${t} <> ${v}`;
    case "parmi": {
      const toutes = String(v).split(SEPARATEUR);
      const vs = toutes.filter((x) => x !== VIDE);
      const liste = sql.join(
        vs.map((x) => sql`${x}`),
        sql`, `,
      );
      const parmi =
        vs.length === 0
          ? undefined
          : e.liste
            ? sql`EXISTS (SELECT 1 FROM unnest(${e.sql}) AS element WHERE ${normaliser(sql`element`)} IN (${liste}))`
            : sql`${t} IN (${liste})`;
      const vide = toutes.includes(VIDE) ? sql`${t} = ''` : undefined;
      return parmi && vide ? sql`(${parmi} OR ${vide})` : (parmi ?? vide);
    }
    default:
      return undefined;
  }
}

/** Condition WHERE d'un filtre ; undefined s'il n'y a rien à filtrer. */
export function conditionFiltre(
  filtre: Filtre,
  colonnes: DefColonne[],
  expressions: Record<string, ExpressionColonne>,
): SQL | undefined {
  const parties = filtre.conditions.flatMap((c) => {
    const def = colonnes.find((d) => d.id === c.colonne);
    const e = expressions[c.colonne];
    const s = def && e ? condition(c, def, e) : undefined;
    return s ? [s] : [];
  });
  if (parties.length === 0) return undefined;
  return filtre.mode === "ou" ? or(...parties) : and(...parties);
}

/**
 * Clé ORDER BY d'une colonne triée (#107), avec les règles de `trierLignes` :
 * accents et majuscules ignorés, nombres et dates dans leur ordre, vides en
 * dernier. undefined sans tri (l'appelant garde son ordre par défaut).
 */
export function ordreColonne(
  tri: Tri | null,
  colonnes: DefColonne[],
  expressions: Record<string, ExpressionColonne>,
): SQL | undefined {
  const def = tri && colonnes.find((d) => d.id === tri.colonne);
  const e = tri && expressions[tri.colonne];
  if (!tri || !def || !e || def.triable === false) return undefined;
  const cle =
    def.type === "nombre"
      ? sql`(${e.sql})::numeric`
      : def.type === "date"
        ? sql`(${e.sql})::date`
        : sql`nullif(${normaliser(e.liste ? sql`array_to_string(${e.sql}, ', ')` : sql`(${e.sql})::text`)}, '')`;
  return tri.sens === "desc" ? sql`${cle} DESC NULLS LAST` : sql`${cle} ASC NULLS LAST`;
}
