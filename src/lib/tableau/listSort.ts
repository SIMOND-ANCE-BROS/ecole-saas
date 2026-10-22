/** Column sort of a back-office list (#443), kept in the URL as `?sort=<field>&order=<asc|desc>`. */
export type SortOrder = 'asc' | 'desc';

export interface SortState<Field extends string = string> {
  by: Field;
  order: SortOrder;
}

/** The sort of the URL when its field is one of `fields`; otherwise the list's default order. */
export function readSort<Field extends string>(
  params: URLSearchParams,
  fields: readonly Field[],
): SortState<Field> | null {
  const by = params.get('sort');
  const field = fields.find((f) => f === by);
  if (!field) return null;
  return { by: field, order: params.get('order') === 'desc' ? 'desc' : 'asc' };
}

/** Writes `sort` into `params` (nothing for the default order). */
export function writeSort(params: URLSearchParams, sort: SortState | null): void {
  if (!sort) return;
  params.set('sort', sort.by);
  params.set('order', sort.order);
}

/** Header click: ascending, then descending, then back to the list's default order. */
export function nextSort<Field extends string>(
  current: SortState<Field> | null,
  field: Field,
): SortState<Field> | null {
  if (current?.by !== field) return { by: field, order: 'asc' };
  return current.order === 'asc' ? { by: field, order: 'desc' } : null;
}

/** API query fields of a sort (none for the default order). */
export function sortQuery<Field extends string>(
  sort: SortState<Field> | null,
): { sortBy?: Field; sortOrder?: SortOrder } {
  return sort ? { sortBy: sort.by, sortOrder: sort.order } : {};
}
