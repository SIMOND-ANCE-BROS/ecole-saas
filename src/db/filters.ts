import { and, or, type SQL, sql } from "drizzle-orm";
import {
  DIACRITICS,
  type Condition,
  type ColumnDef,
  type Filter,
  SANS_ACCENTS,
  SEPARATOR,
  EMPTY,
  type Sort,
  normalizedValue,
} from "../domain/filters/filters";

/**
 * SQL translation of the column filters (`src/domain/filters/filters.ts`),
 * with the same rules as the in-memory evaluation: accents and case
 * ignored, digits only for a phone number, a missing value counts as
 * empty. Values go through parameters, never into the SQL text.
 */

/** SQL expression of a column; `list`: an array of texts (guardians…). */
export type ColumnExpression = { sql: SQL; list?: boolean };

const normalize = (x: SQL) =>
  sql`regexp_replace(btrim(translate(lower(${x}), ${DIACRITICS}, ${SANS_ACCENTS})), '\\s+', ' ', 'g')`;

function condition(c: Condition, def: ColumnDef, e: ColumnExpression): SQL | undefined {
  const v = normalizedValue(c, def.type);
  if (v === null) return undefined;

  if (def.type === "number") {
    const n = sql`(${e.sql})::numeric`;
    switch (c.operator) {
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
    switch (c.operator) {
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

  const raw = e.list ? sql`array_to_string(${e.sql}, ', ')` : sql`(${e.sql})::text`;
  const t =
    def.type === "phone"
      ? sql`regexp_replace(coalesce(${raw}, ''), '[^0-9]', '', 'g')`
      : normalize(sql`coalesce(${raw}, '')`);
  // A list "is" X if one of its items equals X.
  const unElement = sql`EXISTS (SELECT 1 FROM unnest(${e.sql}) AS element WHERE ${normalize(sql`element`)} = ${v})`;
  switch (c.operator) {
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
      return e.list ? unElement : sql`${t} = ${v}`;
    case "n_est_pas":
      return e.list ? sql`NOT ${unElement}` : sql`${t} <> ${v}`;
    case "parmi": {
      const toutes = String(v).split(SEPARATOR);
      const vs = toutes.filter((x) => x !== EMPTY);
      const list = sql.join(
        vs.map((x) => sql`${x}`),
        sql`, `,
      );
      const parmi =
        vs.length === 0
          ? undefined
          : e.list
            ? sql`EXISTS (SELECT 1 FROM unnest(${e.sql}) AS element WHERE ${normalize(sql`element`)} IN (${list}))`
            : sql`${t} IN (${list})`;
      const vide = toutes.includes(EMPTY) ? sql`${t} = ''` : undefined;
      return parmi && vide ? sql`(${parmi} OR ${vide})` : (parmi ?? vide);
    }
    default:
      return undefined;
  }
}

/** WHERE condition of a filter; undefined if there is nothing to filter. */
export function filterCondition<Id extends string>(
  filter: Filter,
  columns: readonly ColumnDef<Id>[],
  expressions: Record<NoInfer<Id>, ColumnExpression>,
): SQL | undefined {
  const parties = filter.conditions.flatMap((c) => {
    const def = columns.find((d) => d.id === c.column);
    const e = def && expressions[def.id];
    const s = def && e ? condition(c, def, e) : undefined;
    return s ? [s] : [];
  });
  if (parties.length === 0) return undefined;
  return filter.mode === "ou" ? or(...parties) : and(...parties);
}

/**
 * ORDER BY key of a sorted column (#107), with the rules of `sortRows`:
 * accents and case ignored, numbers and dates in their order, empty values
 * last. undefined without sorting (the caller keeps its default order).
 */
export function columnOrder<Id extends string>(
  currentSort: Sort | null,
  columns: readonly ColumnDef<Id>[],
  expressions: Record<NoInfer<Id>, ColumnExpression>,
): SQL | undefined {
  const def = currentSort && columns.find((d) => d.id === currentSort.column);
  const e = def && expressions[def.id];
  if (!currentSort || !def || !e || def.sortable === false) return undefined;
  const key =
    def.type === "number"
      ? sql`(${e.sql})::numeric`
      : def.type === "date"
        ? sql`(${e.sql})::date`
        : sql`nullif(${normalize(e.list ? sql`array_to_string(${e.sql}, ', ')` : sql`(${e.sql})::text`)}, '')`;
  return currentSort.direction === "desc" ? sql`${key} DESC NULLS LAST` : sql`${key} ASC NULLS LAST`;
}
