/**
 * Préférences de colonnes d'une liste, repris du back-office de FFD-Connect
 * (`apps/admin/src/lib/columnPrefs.ts`, #107) : colonnes affichées ou masquées,
 * largeurs choisies à la souris, ordre. Ici, elles sont enregistrées par
 * membre en base (`preference_liste`, #89 et #102) dans le format de
 * `domaine/filtres/disposition.ts` : `nom@180`, `-age`. Seul ce qui diffère des
 * valeurs par défaut compte, si bien qu'une colonne ajoutée plus tard suit
 * son réglage par défaut.
 */
export interface ColumnPrefs {
  /** Affichée (true) ou masquée (false), pour les colonnes dont le réglage par défaut a changé. */
  visible: Record<string, boolean>;
  /** Largeur en px des colonnes redimensionnées à la souris. */
  widths: Record<string, number>;
  /** Clés des colonnes dans l'ordre choisi ; vide : l'ordre par défaut. */
  order: string[];
}

export const DEFAULT_COLUMN_PREFS: ColumnPrefs = { visible: {}, widths: {}, order: [] };

/** Bornes d'une largeur choisie à la souris, en px (les mêmes que `disposition.ts`). */
export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 1200;

export const clampColumnWidth = (width: number): number =>
  Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));

export const isDefaultColumnPrefs = (prefs: ColumnPrefs): boolean =>
  Object.keys(prefs.visible).length === 0 &&
  Object.keys(prefs.widths).length === 0 &&
  prefs.order.length === 0;

/**
 * Préférences lues dans l'enregistrement du membre (`["nom@180", "-age"]`) :
 * clés inconnues ignorées, largeurs bornées, l'ordre gardé seulement s'il
 * diffère de l'ordre par défaut.
 */
export function depuisEnregistrement(enregistree: readonly string[] | null, columns: readonly ColumnVisibility[]): ColumnPrefs {
  if (!enregistree) return DEFAULT_COLUMN_PREFS;
  const connues = new Map(columns.map((c) => [c.key, c]));
  const prefs: ColumnPrefs = { visible: {}, widths: {}, order: [] };
  for (const brut of enregistree) {
    const masquee = brut.startsWith("-");
    const [key, largeur] = (masquee ? brut.slice(1) : brut).split("@");
    const column = connues.get(key);
    if (!column || prefs.order.includes(key)) continue;
    prefs.order.push(key);
    if (!column.required && masquee !== Boolean(column.hiddenByDefault)) prefs.visible[key] = !masquee;
    if (largeur && /^\d+$/.test(largeur)) prefs.widths[key] = clampColumnWidth(Number(largeur));
  }
  const parDefaut = columns.map((c) => c.key);
  const memeOrdre = orderColumns(columns, prefs.order).every((c, i) => c.key === parDefaut[i]);
  return { ...prefs, order: memeOrdre ? [] : prefs.order };
}

/** Enregistrement complet des préférences : toutes les colonnes dans l'ordre affiché. */
export function versEnregistrement(prefs: ColumnPrefs, columns: readonly ColumnVisibility[]): string[] {
  return orderColumns(columns, prefs.order).map((c) => {
    const largeur = prefs.widths[c.key];
    return `${isColumnVisible(c, prefs) ? "" : "-"}${c.key}${largeur ? `@${largeur}` : ""}`;
  });
}

export interface ColumnVisibility {
  key: string;
  /** Identification column: always shown, not offered in the picker. */
  required?: boolean;
  /** Off until the admin ticks it. */
  hiddenByDefault?: boolean;
}

export function isColumnVisible(column: ColumnVisibility, prefs: ColumnPrefs): boolean {
  if (column.required) return true;
  return prefs.visible[column.key] ?? !column.hiddenByDefault;
}

/**
 * `columns` in the order the admin chose (#671). A column missing from the
 * stored order (added since) keeps its default place among the others; a
 * stored key that no longer exists is ignored.
 */
export function orderColumns<T extends { key: string }>(
  columns: readonly T[],
  order: readonly string[],
): T[] {
  if (order.length === 0) return [...columns];
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const ordered = order.flatMap((key) => {
    const column = byKey.get(key);
    return column ? [column] : [];
  });
  columns.forEach((column, index) => {
    if (!order.includes(column.key)) ordered.splice(Math.min(index, ordered.length), 0, column);
  });
  return ordered;
}

/** `keys` with `key` moved `delta` places (clamped to the ends). */
export function moveKey(keys: readonly string[], key: string, delta: number): string[] {
  const from = keys.indexOf(key);
  if (from === -1) return [...keys];
  const to = Math.min(keys.length - 1, Math.max(0, from + delta));
  const next = keys.filter((k) => k !== key);
  next.splice(to, 0, key);
  return next;
}

/** `keys` with `key` dropped just before or after `target` (drag and drop of a header). */
export function dropKey(
  keys: readonly string[],
  key: string,
  target: string,
  side: 'before' | 'after',
): string[] {
  if (key === target || !keys.includes(key) || !keys.includes(target)) return [...keys];
  const next = keys.filter((k) => k !== key);
  const at = next.indexOf(target) + (side === 'after' ? 1 : 0);
  next.splice(at, 0, key);
  return next;
}
