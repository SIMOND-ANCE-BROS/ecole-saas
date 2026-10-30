import type { KeyboardEvent } from "react";

/** What the check reads of the element the key was pressed on. */
export type AttributeReader = { getAttribute(name: string): string | null };

/**
 * Whether the element the key was pressed on has a drop-down list open
 * (#332). Mantine 8 `Select` and `Autocomplete` set no `aria-expanded` on
 * their input: they mark an open list with `data-expanded` and
 * `data-mantine-stop-propagation`, the attribute Mantine's own modals read
 * to leave such an Escape to the list. `aria-expanded` still covers the
 * other controls (menus, disclosure buttons).
 */
export function listOpenOn(target: AttributeReader): boolean {
  return (
    target.getAttribute("data-mantine-stop-propagation") !== null ||
    target.getAttribute("data-expanded") !== null ||
    target.getAttribute("aria-expanded") === "true"
  );
}

/**
 * Whether an Escape key press cancels the form around it: not when a list
 * open on the target closes first (a second Escape cancels), nor when a
 * control already handled it (the date field's calendar).
 */
export function escapeCancels(key: string, defaultPrevented: boolean, target: AttributeReader | null): boolean {
  return key === "Escape" && !defaultPrevented && !(target && listOpenOn(target));
}

/**
 * `onKeyDown` of an inline form that Escape cancels (settings forms): Escape
 * with a drop-down list open only closes the list, a second Escape calls
 * `close`. Side panels handle this themselves (`_panel/panel.tsx`).
 */
export function cancelOnEscape(close: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (escapeCancels(e.key, e.defaultPrevented, e.target instanceof Element ? e.target : null)) close();
  };
}
