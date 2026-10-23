import type { ColumnDef } from "./filtres";

/**
 * Disposition des colonnes d'une liste (#89) : ordre et visibilité, choisis
 * par chaque membre. Enregistrée comme la liste de toutes les colonnes dans
 * l'ordre, les masquées préfixées par « - » : une colonne ajoutée plus tard
 * au logiciel garde ainsi sa visibilité par défaut au lieu de passer pour
 * masquée. Une largeur choisie s'écrit après « @ », en pixels (#102) :
 * `nom@180`, `-age@90`.
 */

export type Layout = { id: string; visible: boolean; width?: number | null }[];

/** Bornes d'une largeur de colonne choisie à la souris. */
export const MIN_WIDTH = 60;
export const MAX_WIDTH = 1200;
const clamp = (l: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, l)));

const visibleByDefault = (c: ColumnDef) => c.byDefault !== false;

/** Disposition par défaut : ordre des définitions, colonnes `parDefaut: false` masquées. */
export const defaultLayout = (columns: ColumnDef[]): Layout =>
  columns.map((c) => ({ id: c.id, visible: visibleByDefault(c) }));

/**
 * Disposition d'un membre : identifiants inconnus et doublons ignorés,
 * colonnes absentes ajoutées à la fin avec leur visibilité par défaut. Au
 * moins une colonne reste visible, et toujours une colonne obligatoire (le nom).
 */
export function readLayout(columns: ColumnDef[], saved: string[] | null | undefined): Layout {
  if (!saved) return defaultLayout(columns);
  const known = new Set(columns.map((c) => c.id));
  const required = new Set(columns.filter((c) => c.required).map((c) => c.id));
  const vues = new Set<string>();
  const d: Layout = [];
  for (const raw of saved) {
    const hidden = raw.startsWith("-");
    const [id, l] = (hidden ? raw.slice(1) : raw).split("@");
    if (!known.has(id) || vues.has(id)) continue;
    vues.add(id);
    const width = l && /^\d+$/.test(l) ? clamp(Number(l)) : null;
    d.push({ id, visible: !hidden || required.has(id), ...(width ? { width } : {}) });
  }
  for (const c of columns) if (!vues.has(c.id)) d.push({ id: c.id, visible: visibleByDefault(c) });
  if (!d.some((c) => c.visible) && d.length > 0) d[0] = { ...d[0], visible: true };
  return d;
}

export const writeLayout = (d: Layout): string[] =>
  d.map((c) => `${c.visible ? "" : "-"}${c.id}${c.width ? `@${c.width}` : ""}`);

/** Place la colonne `id` juste avant `avant` (glisser-déposer d'un en-tête) ; `avant` null : à la fin. */
export function place(d: Layout, id: string, before: string | null): Layout {
  const c = d.find((x) => x.id === id);
  if (!c || id === before) return d;
  const remaining = d.filter((x) => x.id !== id);
  const i = before === null ? remaining.length : remaining.findIndex((x) => x.id === before);
  if (i === -1) return d;
  return [...remaining.slice(0, i), c, ...remaining.slice(i)];
}

/** Largeur choisie d'une colonne, bornée ; null : largeur automatique. */
export function resize(d: Layout, id: string, width: number | null): Layout {
  return d.map((c) => (c.id === id ? { ...c, width: width === null ? null : clamp(width) } : c));
}

/** Déplace une colonne d'un cran (-1 : vers la gauche, +1 : vers la droite). */
export function move(d: Layout, id: string, sens: -1 | 1): Layout {
  const i = d.findIndex((c) => c.id === id);
  const j = i + sens;
  if (i === -1 || j < 0 || j >= d.length) return d;
  const r = [...d];
  [r[i], r[j]] = [r[j], r[i]];
  return r;
}

/** Affiche ou masque une colonne ; la dernière colonne visible ne peut pas être masquée. */
export function toggle(d: Layout, id: string): Layout {
  const target = d.find((c) => c.id === id);
  if (!target || (target.visible && d.filter((c) => c.visible).length === 1)) return d;
  return d.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c));
}
