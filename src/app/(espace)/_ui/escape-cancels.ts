/** What the check reads of the element the key was pressed on. */
export type EscapeTarget = {
  getAttribute(name: string): string | null;
  closest(selectors: string): unknown;
};

/**
 * Where a page's drop-down lists, calendars, menus and dialogs are rendered: each Mantine
 * `Portal` is a `[data-portal]` node. A side panel passes its own portal instead.
 */
export const PAGE_PORTALS = "[data-portal]";

/**
 * Whether Escape pressed on `target` belongs to a list, calendar, menu or dialog that closes
 * first (#332, #339), the one check shared by the side panel and the inline settings forms:
 *
 * - on the field itself: Mantine 8 `Select`, `Autocomplete` and `Menu` set no `aria-expanded`
 *   there; they mark an open list with `data-expanded` (with `data-mantine-stop-propagation`,
 *   the attribute Mantine's own modals read to leave such an Escape to the list). `DateField`
 *   marks its open calendar the same way. `aria-expanded` covers the other controls
 *   (popovers, disclosure buttons);
 * - inside the dropdown or dialog itself (a menu item, a button of « Abandonner la saisie ? »),
 *   rendered in `portal`.
 */
export function listOpenOn(target: EscapeTarget, portal: string = PAGE_PORTALS): boolean {
  return (
    target.getAttribute("data-mantine-stop-propagation") !== null ||
    target.getAttribute("data-expanded") !== null ||
    target.getAttribute("aria-expanded") === "true" ||
    target.closest(portal) !== null
  );
}

/**
 * Whether an Escape key press leaves the form around it: not when a list open on the target
 * closes first (a second Escape leaves), nor when a control already handled it and prevented
 * its default.
 */
export function escapeCancels(
  key: string,
  defaultPrevented: boolean,
  target: EscapeTarget | null,
  portal: string = PAGE_PORTALS,
): boolean {
  return key === "Escape" && !defaultPrevented && !(target && listOpenOn(target, portal));
}

/** What Escape does to a form: nothing, leave at once, or ask « Abandonner la saisie ? » first. */
export type EscapeOutcome = "none" | "leave" | "ask";

/**
 * Escape leaves a form at once when nothing typed or chosen would be lost, and asks first
 * when it holds unsaved input (#251, #339). `holdsInput` is only read for an Escape that
 * leaves.
 */
export function escapeOutcome(
  key: string,
  defaultPrevented: boolean,
  target: EscapeTarget | null,
  holdsInput: () => boolean,
  portal: string = PAGE_PORTALS,
): EscapeOutcome {
  if (!escapeCancels(key, defaultPrevented, target, portal)) return "none";
  return holdsInput() ? "ask" : "leave";
}

/** The element a key was pressed on, if any (`Element` is undefined outside a browser). */
export const elementOf = (target: EventTarget | null): Element | null =>
  typeof Element !== "undefined" && target instanceof Element ? target : null;

/** What `cancelOnEscape` reads of a key press. */
export type EscapeKeyEvent = {
  key: string;
  defaultPrevented: boolean;
  target: EventTarget | null;
  preventDefault(): void;
};

/**
 * `onKeyDown` of an inline form that Escape cancels (settings forms, #339): Escape with a
 * list open only closes the list; then, with unsaved input, `ask` (« Abandonner la saisie ? »),
 * else `close` at once. Use it through `useEscapeCancels` (`escape-asks.tsx`), which keeps the
 * input state and the question; side panels handle Escape themselves (`_panel/panel.tsx`)
 * with the same `escapeCancels`.
 */
export function cancelOnEscape(close: () => void, { holdsInput, ask }: { holdsInput: () => boolean; ask: () => void }) {
  return (e: EscapeKeyEvent) => {
    const outcome = escapeOutcome(e.key, e.defaultPrevented, elementOf(e.target), holdsInput);
    if (outcome === "none") return;
    // Handled: an enclosing handler that reads `defaultPrevented` leaves it alone.
    e.preventDefault();
    if (outcome === "ask") ask();
    else close();
  };
}
