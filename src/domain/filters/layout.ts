import type { ColumnDef } from "./filters";

/**
 * Column layout of a list (#89): order and visibility, chosen by each
 * member. Saved as the list of all columns in order, hidden ones prefixed
 * with "-": a column added to the software later thus keeps its default
 * visibility instead of passing for hidden. A chosen width is written after
 * "@", in pixels (#102): `nom@180`, `-age@90`.
 */

export type Layout = { id: string; visible: boolean; width?: number | null }[];

/** Bounds of a column width chosen with the mouse. */
export const MIN_WIDTH = 60;
export const MAX_WIDTH = 1200;
const clamp = (l: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, l)));

const visibleByDefault = (c: ColumnDef) => c.byDefault !== false;

/** Default layout: definition order, `byDefault: false` columns hidden. */
export const defaultLayout = (columns: ColumnDef[]): Layout =>
  columns.map((c) => ({ id: c.id, visible: visibleByDefault(c) }));

/**
 * A member's layout: unknown ids and duplicates ignored, missing columns
 * added at the end with their default visibility. At least one column stays
 * visible, and a required column (the name) always does.
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

/** Puts column `id` just before `before` (header drag and drop); `before` null: at the end. */
export function place(d: Layout, id: string, before: string | null): Layout {
  const c = d.find((x) => x.id === id);
  if (!c || id === before) return d;
  const remaining = d.filter((x) => x.id !== id);
  const i = before === null ? remaining.length : remaining.findIndex((x) => x.id === before);
  if (i === -1) return d;
  return [...remaining.slice(0, i), c, ...remaining.slice(i)];
}

/** A column's chosen width, clamped; null: automatic width. */
export function resize(d: Layout, id: string, width: number | null): Layout {
  return d.map((c) => (c.id === id ? { ...c, width: width === null ? null : clamp(width) } : c));
}

/** Moves a column one step (-1: to the left, +1: to the right). */
export function move(d: Layout, id: string, sens: -1 | 1): Layout {
  const i = d.findIndex((c) => c.id === id);
  const j = i + sens;
  if (i === -1 || j < 0 || j >= d.length) return d;
  const r = [...d];
  [r[i], r[j]] = [r[j], r[i]];
  return r;
}

/** Shows or hides a column; the last visible column cannot be hidden. */
export function toggle(d: Layout, id: string): Layout {
  const target = d.find((c) => c.id === id);
  if (!target || (target.visible && d.filter((c) => c.visible).length === 1)) return d;
  return d.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c));
}
