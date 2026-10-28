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
export const returnKey = (list: RememberedList) => `retour-liste:${list}`;

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
