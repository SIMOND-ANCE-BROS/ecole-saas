/**
 * Pages of a list (#107): the page number travels in the URL (`?page=2`),
 * the server reads it back, clamps it to the existing pages and fetches only
 * that slice. Filters, sort and search start again from page 1.
 */

/** Rows per page: enough to scan without scrolling forever at the front desk. */
export const PAGE_SIZE = 50;

/** Number of pages for `total` rows; at least 1, so an empty list has a page 1. */
export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/**
 * The page asked for in the URL, clamped to `1…pageCount(total)`: a missing,
 * malformed or out-of-range value (`?page=abc`, `?page=0`, `?page=99` after
 * filtering) gives the nearest existing page instead of an empty list.
 */
export function readPage(value: string | string[] | null | undefined, total: number, size = PAGE_SIZE): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const asked = raw && /^\d{1,6}$/.test(raw) ? Number(raw) : 1;
  return Math.min(Math.max(1, asked), pageCount(total, size));
}

/** Rows to skip before `page`. */
export function offsetOf(page: number, size = PAGE_SIZE): number {
  return (Math.max(1, page) - 1) * size;
}

/** « 51–100 sur 134 »: the rows shown, for the line under the table. */
export function shownRange(page: number, total: number, size = PAGE_SIZE): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  const from = offsetOf(page, size) + 1;
  return { from, to: Math.min(total, from + size - 1) };
}
