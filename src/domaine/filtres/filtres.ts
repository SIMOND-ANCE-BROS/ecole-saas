/**
 * Filtres par colonne des listes (élèves, contacts, intervenants) : lecture
 * et écriture dans l'adresse, et évaluation en mémoire. La traduction SQL
 * (`src/db/filtres.ts`) applique exactement les mêmes règles.
 *
 * Adresse : `?f=colonne.operateur.valeur` (répété) et `mode=ou` ; la valeur
 * peut contenir des points, seuls les deux premiers séparent.
 */

/** `date` : jour `YYYY-MM-DD` (date de naissance…). */
export type ColumnType = "texte" | "nombre" | "telephone" | "date";

export type ColumnDef = {
  id: string;
  label: string;
  type: ColumnType;
  /** false : colonne proposée mais masquée tant que le membre ne l'affiche pas (#89). */
  byDefault?: boolean;
  /** Nombres : alignés à droite. */
  right?: boolean;
  /** false : colonne affichée mais sans filtre (montant mis en forme…). */
  filterable?: boolean;
  /** Valeurs possibles : la colonne se filtre par cases à cocher (#107). La page peut en fournir (cours de la saison). */
  choice?: readonly string[];
  /** Colonne qui identifie la ligne (le nom) : toujours affichée, jamais masquable (#107). */
  required?: boolean;
  /** false : un clic sur le titre ne trie pas. */
  sortable?: boolean;
  /** Adresse e-mail : affichée en lien `mailto:`. */
  email?: boolean;
  /** Texte d'une cellule vide (« l’élève » pour « Facturé à »), sinon un tiret. */
  ifEmpty?: string;
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
/** Au-delà, la barre devient illisible et la requête inutilement lourde. */
export const CONDITIONS_MAX = 8;

const TEXT: Operator[] = ["contient", "ne_contient_pas", "est", "n_est_pas", "commence", "vide", "non_vide", "parmi"];
export const OPERATORS: Record<ColumnType, Operator[]> = {
  texte: TEXT,
  telephone: ["contient", "commence", "vide", "non_vide"],
  nombre: ["egal", "different", "sup", "sup_egal", "inf", "inf_egal", "vide", "non_vide"],
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
 * « parmi » (cases à cocher d'une colonne, #107) : valeurs séparées par `|`,
 * `(vide)` pour les lignes sans valeur. `Inscrit|(vide)` : inscrits ou sans inscription.
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

/** Libellé d'un opérateur selon le type de la colonne (« avant le » pour une date). */
export const operatorLabel = (o: Operator, type: ColumnType) =>
  (type === "date" && DATE_LABELS[o]) || OPERATOR_LABELS[o];

export const withoutValue = (o: Operator) => o === "vide" || o === "non_vide";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Correspondances d'accents, partagées avec la traduction SQL (`translate`). */
export const ACCENTS = "àâäáãåéèêëíìîïóòôöõúùûüçñÿ";
export const SANS_ACCENTS = "aaaaaaeeeeiiiiooooouuuucny";

/** Minuscules sans accents, espaces réduits. */
export function normalizeText(v: string): string {
  let r = "";
  for (const c of v.toLowerCase()) {
    const i = ACCENTS.indexOf(c);
    r += i === -1 ? c : SANS_ACCENTS[i];
  }
  return r.replace(/\s+/g, " ").trim();
}

export const digits = (v: string) => v.replace(/\D/g, "");

/** Nombre saisi (virgule ou point) ; null si ce n'est pas un nombre. */
export function readNumber(v: string): number | null {
  const t = v.trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** Valeur exploitable pour cette condition, ou null si elle doit être ignorée. */
export function normalizedValue(c: Condition, type: ColumnType): string | number | null {
  if (withoutValue(c.operator)) return "";
  if (type === "nombre") return readNumber(c.value);
  if (type === "date") return DATE.test(c.value.trim()) ? c.value.trim() : null;
  if (c.operator === "parmi") {
    const vs = amongValues(c.value).map((x) => (x === EMPTY ? EMPTY : normalizeText(x)));
    return vs.length ? vs.join(SEPARATOR) : null;
  }
  const v = type === "telephone" ? digits(c.value) : normalizeText(c.value);
  return v === "" ? null : v;
}

/** Conditions valides de l'adresse : colonne connue, opérateur adapté, valeur exploitable. */
export function readFilter(
  f: string | string[] | undefined | null,
  mode: string | string[] | undefined | null,
  columns: ColumnDef[],
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

/** Paramètres d'adresse d'un filtre (le mode n'est écrit que s'il compte). */
export function toParams(filter: Filter): [string, string][] {
  const p: [string, string][] = filter.conditions.map((c) => [
    "f",
    withoutValue(c.operator) ? `${c.column}.${c.operator}` : `${c.column}.${c.operator}.${c.value}`,
  ]);
  if (filter.mode === "ou" && filter.conditions.length > 1) p.push(["mode", "ou"]);
  return p;
}

/** Valeur d'une cellule : texte, nombre, liste (responsables…) ou absente. */
export type Cellule = string | number | string[] | null | undefined;

function evaluate(cellule: Cellule, c: Condition, type: ColumnType): boolean {
  const v = normalizedValue(c, type);
  if (type === "nombre") {
    const n = typeof cellule === "number" ? cellule : null;
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
    const d = typeof cellule === "string" && cellule !== "" ? cellule.slice(0, 10) : null;
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
  const raw = Array.isArray(cellule) ? cellule.join(", ") : cellule == null ? "" : String(cellule);
  const t = type === "telephone" ? digits(raw) : normalizeText(raw);
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
    // Une liste « est » X si l'un de ses éléments vaut X.
    case "est":
      return Array.isArray(cellule) ? cellule.some((e) => normalizeText(e) === target) : t === target;
    case "n_est_pas":
      return Array.isArray(cellule) ? !cellule.some((e) => normalizeText(e) === target) : t !== target;
    case "commence":
      return t.startsWith(target);
    case "parmi": {
      const vs = target.split(SEPARATOR);
      if (t === "") return vs.includes(EMPTY);
      return Array.isArray(cellule) ? cellule.some((e) => vs.includes(normalizeText(e))) : vs.includes(t);
    }
    default:
      return false;
  }
}

/** Lignes qui satisfont toutes (ET) ou au moins une (OU) des conditions. */
export function applyFilter<T>(rows: T[], filter: Filter, columns: (ColumnDef & { value: (l: T) => Cellule })[]): T[] {
  const actives = filter.conditions.flatMap((c) => {
    const def = columns.find((d) => d.id === c.column);
    return def ? [{ c, def }] : [];
  });
  if (actives.length === 0) return rows;
  return rows.filter((l) => {
    const r = actives.map(({ c, def }) => evaluate(def.value(l), c, def.type));
    return filter.mode === "ou" ? r.some(Boolean) : r.every(Boolean);
  });
}

/** « Âge > 10 », « Responsables contient « Martin » », « Téléphone est vide » : pour les pastilles. */
export function conditionLabel(c: Condition, columns: ColumnDef[]): string {
  const def = columns.find((d) => d.id === c.column);
  const op = operatorLabel(c.operator, def?.type ?? "texte");
  const name = def?.label ?? c.column;
  if (withoutValue(c.operator)) return `${name} ${op}`;
  if (def?.type === "date") return `${name} ${op} ${c.value.split("-").reverse().join("/")}`;
  return def?.type === "nombre" ? `${name} ${op} ${c.value}` : `${name} ${op} « ${c.value} »`;
}

/** Tri d'une liste par une colonne (#107), dans l'adresse : `?sort=age&order=desc`. */
export type Sort = { column: string; sens: "asc" | "desc" };

/** Tri de l'adresse s'il porte sur une colonne connue et triable ; sinon null (ordre par défaut). */
export function readSort(
  sort: string | string[] | undefined | null,
  order: string | string[] | undefined | null,
  columns: ColumnDef[],
): Sort | null {
  const column = Array.isArray(sort) ? sort[0] : sort;
  const def = columns.find((c) => c.id === column);
  if (!def || def.sortable === false) return null;
  return { column: def.id, sens: (Array.isArray(order) ? order[0] : order) === "desc" ? "desc" : "asc" };
}

/** Tri en mémoire, avec les règles du tri SQL : accents ignorés, nombres en ordre numérique, vides en dernier. */
export function sortRows<L>(rows: L[], currentSort: Sort | null, value: (l: L, column: string) => Cellule): L[] {
  if (!currentSort) return rows;
  const key = (v: Cellule) => (Array.isArray(v) ? v.join(", ") : v);
  const sens = currentSort.sens === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = key(value(a, currentSort.column));
    const y = key(value(b, currentSort.column));
    const xEmpty = x == null || x === "";
    const yEmpty = y == null || y === "";
    if (xEmpty || yEmpty) return xEmpty === yEmpty ? 0 : xEmpty ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * sens;
    return normalizeText(String(x)).localeCompare(normalizeText(String(y)), "fr", { numeric: true }) * sens;
  });
}
