/**
 * Per-column filters of the lists (students, contacts, instructors): reading
 * and writing in the URL, and in-memory evaluation. The SQL translation
 * (`src/db/filters.ts`) applies exactly the same rules.
 *
 * URL: `?f=column.operator.value` (repeated) and `mode=ou`; the value may
 * contain dots, only the first two separate.
 */

/** `date`: day `YYYY-MM-DD` (date of birth…). */
export type ColumnType = "text" | "number" | "phone" | "date";

/** A list column; `Id` narrows the ids so cells and SQL expressions are checked against them (#138). */
export type ColumnDef<Id extends string = string> = {
  id: Id;
  label: string;
  type: ColumnType;
  /** false: column offered but hidden until the member shows it (#89). */
  byDefault?: boolean;
  /** Numbers: right-aligned. */
  right?: boolean;
  /** false: column displayed but not filterable (formatted amount…). */
  filterable?: boolean;
  /** Possible values: the column is filtered by checkboxes (#107). The page may supply them (season's courses). */
  choice?: readonly string[];
  /** Column that identifies the row (the name): always displayed, never hideable (#107). */
  required?: boolean;
  /** false: clicking the header does not sort. */
  sortable?: boolean;
  /** E-mail address: displayed as a `mailto:` link. */
  email?: boolean;
  /** Text of an empty cell (« l’élève » for « Facturé à »), otherwise a dash. */
  ifEmpty?: string;
  /** Dates years back (birth dates): the filter's calendar opens on the years, not on this month. */
  yearsBack?: boolean;
};

export type Operator =
  | "contient"
  | "ne_contient_pas"
  | "est"
  | "n_est_pas"
  | "commence"
  | "egal"
  | "different"
  | "sup"
  | "sup_egal"
  | "inf"
  | "inf_egal"
  | "vide"
  | "non_vide"
  | "parmi";

export type Condition = { column: string; operator: Operator; value: string };
export type Mode = "et" | "ou";
export type Filter = { mode: Mode; conditions: Condition[] };

export const EMPTY_FILTER: Filter = { mode: "et", conditions: [] };
/** Beyond this, the bar becomes unreadable and the query needlessly heavy. */
export const CONDITIONS_MAX = 8;

const TEXT: Operator[] = ["contient", "ne_contient_pas", "est", "n_est_pas", "commence", "vide", "non_vide", "parmi"];
export const OPERATORS: Record<ColumnType, Operator[]> = {
  text: TEXT,
  phone: ["contient", "commence", "vide", "non_vide"],
  number: ["egal", "different", "sup", "sup_egal", "inf", "inf_egal", "vide", "non_vide"],
  date: ["egal", "inf", "sup", "inf_egal", "sup_egal", "vide", "non_vide"],
};

export const OPERATOR_LABELS: Record<Operator, string> = {
  contient: "contient",
  ne_contient_pas: "ne contient pas",
  est: "est",
  n_est_pas: "n’est pas",
  commence: "commence par",
  egal: "=",
  different: "≠",
  sup: ">",
  sup_egal: "≥",
  inf: "<",
  inf_egal: "≤",
  vide: "est vide",
  non_vide: "n’est pas vide",
  parmi: "est parmi",
};

/**
 * « parmi » (a column's checkboxes, #107): values separated by `|`,
 * `(vide)` for rows without a value. `Inscrit|(vide)`: enrolled or without enrollment.
 */
export const EMPTY = "(vide)";
export const SEPARATOR = "|";
export const amongValues = (value: string) => value.split(SEPARATOR).filter((v) => v.trim() !== "");

const DATE_LABELS: Partial<Record<Operator, string>> = {
  egal: "le",
  inf: "avant le",
  sup: "après le",
  inf_egal: "jusqu’au",
  sup_egal: "depuis le",
};

/** An operator's label according to the column type (« avant le » for a date). */
export const operatorLabel = (o: Operator, type: ColumnType) =>
  (type === "date" ? DATE_LABELS[o] : undefined) ?? OPERATOR_LABELS[o];

export const withoutValue = (o: Operator) => o === "vide" || o === "non_vide";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Accent mappings, shared with the SQL translation (`translate`). */
export const DIACRITICS = "àâäáãåéèêëíìîïóòôöõúùûüçñÿ";
export const SANS_ACCENTS = "aaaaaaeeeeiiiiooooouuuucny";

/** Lower case without accents, collapsed whitespace. */
export function normalizeText(v: string): string {
  let r = "";
  for (const c of v.toLowerCase()) {
    const i = DIACRITICS.indexOf(c);
    r += i === -1 ? c : SANS_ACCENTS[i];
  }
  return r.replace(/\s+/g, " ").trim();
}

export const digits = (v: string) => v.replace(/\D/g, "");

/** Number as typed (comma or dot); null if it is not a number. */
export function readNumber(v: string): number | null {
  const t = v.trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** Usable value for this condition, or null if it must be ignored. */
export function normalizedValue(c: Condition, type: ColumnType): string | number | null {
  if (withoutValue(c.operator)) return "";
  if (type === "number") return readNumber(c.value);
  if (type === "date") return DATE.test(c.value.trim()) ? c.value.trim() : null;
  if (c.operator === "parmi") {
    const vs = amongValues(c.value).map((x) => (x === EMPTY ? EMPTY : normalizeText(x)));
    return vs.length ? vs.join(SEPARATOR) : null;
  }
  const v = type === "phone" ? digits(c.value) : normalizeText(c.value);
  return v === "" ? null : v;
}

/** Valid URL conditions: known column, suitable operator, usable value. */
export function readFilter(
  f: string | string[] | undefined | null,
  mode: string | string[] | undefined | null,
  columns: readonly ColumnDef[],
): Filter {
  const brutes = (Array.isArray(f) ? f : f ? [f] : []).slice(0, CONDITIONS_MAX);
  const conditions: Condition[] = [];
  for (const b of brutes) {
    const i = b.indexOf(".");
    const j = i === -1 ? -1 : b.indexOf(".", i + 1);
    const column = i === -1 ? b : b.slice(0, i);
    const operator = (i === -1 ? "" : j === -1 ? b.slice(i + 1) : b.slice(i + 1, j)) as Operator;
    const value = j === -1 ? "" : b.slice(j + 1);
    const def = columns.find((c) => c.id === column);
    if (!def || def.filterable === false || !OPERATORS[def.type].includes(operator)) continue;
    const c = { column: column, operator: operator, value: withoutValue(operator) ? "" : value };
    if (normalizedValue(c, def.type) !== null) conditions.push(c);
  }
  const m = Array.isArray(mode) ? mode[0] : mode;
  return { mode: m === "ou" ? "ou" : "et", conditions };
}

/** URL parameters of a filter (the mode is written only when it matters). */
export function toParams(filter: Filter): [string, string][] {
  const p: [string, string][] = filter.conditions.map((c) => [
    "f",
    withoutValue(c.operator) ? `${c.column}.${c.operator}` : `${c.column}.${c.operator}.${c.value}`,
  ]);
  if (filter.mode === "ou" && filter.conditions.length > 1) p.push(["mode", "ou"]);
  return p;
}

/** A cell's value: text, number, list (guardians…) or missing. */
export type Cell = string | number | string[] | null | undefined;

function evaluate(cell: Cell, c: Condition, type: ColumnType): boolean {
  const v = normalizedValue(c, type);
  if (type === "number") {
    const n = typeof cell === "number" ? cell : null;
    if (c.operator === "vide") return n === null;
    if (c.operator === "non_vide") return n !== null;
    if (c.operator === "different") return n !== v;
    if (n === null || typeof v !== "number") return false;
    switch (c.operator) {
      case "egal":
        return n === v;
      case "sup":
        return n > v;
      case "sup_egal":
        return n >= v;
      case "inf":
        return n < v;
      case "inf_egal":
        return n <= v;
      default:
        return false;
    }
  }
  if (type === "date") {
    const d = typeof cell === "string" && cell !== "" ? cell.slice(0, 10) : null;
    if (c.operator === "vide") return d === null;
    if (c.operator === "non_vide") return d !== null;
    if (d === null || typeof v !== "string") return false;
    switch (c.operator) {
      case "egal":
        return d === v;
      case "inf":
        return d < v;
      case "sup":
        return d > v;
      case "inf_egal":
        return d <= v;
      case "sup_egal":
        return d >= v;
      default:
        return false;
    }
  }
  const raw = Array.isArray(cell) ? cell.join(", ") : cell == null ? "" : String(cell);
  const t = type === "phone" ? digits(raw) : normalizeText(raw);
  const target = String(v);
  switch (c.operator) {
    case "vide":
      return t === "";
    case "non_vide":
      return t !== "";
    case "contient":
      return t.includes(target);
    case "ne_contient_pas":
      return !t.includes(target);
    // A list "is" X if one of its items equals X.
    case "est":
      return Array.isArray(cell) ? cell.some((e) => normalizeText(e) === target) : t === target;
    case "n_est_pas":
      return Array.isArray(cell) ? !cell.some((e) => normalizeText(e) === target) : t !== target;
    case "commence":
      return t.startsWith(target);
    case "parmi": {
      const vs = target.split(SEPARATOR);
      if (t === "") return vs.includes(EMPTY);
      return Array.isArray(cell) ? cell.some((e) => vs.includes(normalizeText(e))) : vs.includes(t);
    }
    default:
      return false;
  }
}

/** Rows that satisfy all (AND) or at least one (OR) of the conditions. */
export function applyFilter<T>(rows: T[], filter: Filter, columns: (ColumnDef & { value: (l: T) => Cell })[]): T[] {
  const active = filter.conditions.flatMap((c) => {
    const def = columns.find((d) => d.id === c.column);
    return def ? [{ c, def }] : [];
  });
  if (active.length === 0) return rows;
  return rows.filter((l) => {
    const r = active.map(({ c, def }) => evaluate(def.value(l), c, def.type));
    return filter.mode === "ou" ? r.some(Boolean) : r.every(Boolean);
  });
}

/** « Âge > 10 », « Responsables contient « Martin » », « Téléphone est vide »: for the chips. */
export function conditionLabel(c: Condition, columns: readonly ColumnDef[]): string {
  const def = columns.find((d) => d.id === c.column);
  const op = operatorLabel(c.operator, def?.type ?? "text");
  const name = def?.label ?? c.column;
  if (withoutValue(c.operator)) return `${name} ${op}`;
  if (def?.type === "date") return `${name} ${op} ${c.value.split("-").reverse().join("/")}`;
  return def?.type === "number" ? `${name} ${op} ${c.value}` : `${name} ${op} « ${c.value} »`;
}

/** Sorting a list by a column (#107), in the URL: `?sort=age&order=desc`. */
export type Sort = { column: string; direction: "asc" | "desc" };

/** The URL's sort if it targets a known, sortable column; otherwise null (default order). */
export function readSort(
  sort: string | string[] | undefined | null,
  order: string | string[] | undefined | null,
  columns: readonly ColumnDef[],
): Sort | null {
  const column = Array.isArray(sort) ? sort[0] : sort;
  const def = columns.find((c) => c.id === column);
  if (!def || def.sortable === false) return null;
  return { column: def.id, direction: (Array.isArray(order) ? order[0] : order) === "desc" ? "desc" : "asc" };
}

/** In-memory sort, with the SQL sort's rules: accents ignored, numbers in numeric order, empty values last. */
export function sortRows<L>(rows: L[], currentSort: Sort | null, value: (l: L, column: string) => Cell): L[] {
  if (!currentSort) return rows;
  const key = (v: Cell) => (Array.isArray(v) ? v.join(", ") : v);
  const direction = currentSort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = key(value(a, currentSort.column));
    const y = key(value(b, currentSort.column));
    const xEmpty = x == null || x === "";
    const yEmpty = y == null || y === "";
    if (xEmpty || yEmpty) return xEmpty === yEmpty ? 0 : xEmpty ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * direction;
    return normalizeText(String(x)).localeCompare(normalizeText(String(y)), "fr", { numeric: true }) * direction;
  });
}
