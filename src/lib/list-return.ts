/**
 * « Retour à la liste » (#107): the lists whose last address (filters, sort,
 * search) is remembered, so a record page leads back to the list as it was.
 */
export const REMEMBERED_LISTS = ["/eleves", "/contacts", "/intervenants"] as const;

export type RememberedList = (typeof REMEMBERED_LISTS)[number];

export function isRememberedList(path: string): path is RememberedList {
  return (REMEMBERED_LISTS as readonly string[]).includes(path);
}

/** Key of the list's last address in sessionStorage. */
export const returnKey = (list: RememberedList) => `list-return:${list}`;

/**
 * Parameters that make up the state of a list: search, filters, filter mode,
 * sort. One-shot ones (`?enregistre=…` banners) are not kept: they would show
 * their message again on every return.
 */
const LIST_STATE = ["q", "f", "mode", "sort", "order"] as const;

/** The list's address to remember, from its current query string. */
export function listAddress(list: RememberedList, query: string): string {
  const all = new URLSearchParams(query);
  const kept = new URLSearchParams();
  for (const key of LIST_STATE) for (const value of all.getAll(key)) kept.append(key, value);
  const rest = kept.toString();
  return rest ? `${list}?${rest}` : list;
}

/**
 * The address to go back to: the stored one when it is this very list with
 * its query string, else the bare list. Anything else (another path, another
 * origin, `//host`, a fragment or a backslash) is ignored: no open redirect.
 */
export function listReturn(list: RememberedList, stored: string | null): string {
  if (!stored || stored.length > 2000) return list;
  if (stored === list) return list;
  if (!stored.startsWith(`${list}?`)) return list;
  if (/[\\#\s]/.test(stored)) return list;
  return stored;
}
