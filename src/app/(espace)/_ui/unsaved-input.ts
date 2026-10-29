"use client";

import { type RefObject, useEffect, useRef } from "react";

/** Any field of a form, visible or not (a Select's chosen value lives in a hidden input). */
const FIELDS = "input, select, textarea";
/** A field someone can type in or choose: a container without one (a record) never holds input. */
const EDITABLE = "input:not([type=hidden]), select, textarea";

/** What `readFields` needs of a field: an `<input>`, `<select>` or `<textarea>` fits. */
export type FieldLike = { name: string; id: string; value: string; type?: string; checked?: boolean };

/**
 * What each field holds, keyed by name, else id (Mantine gives every field one),
 * else its position: its text, or « 1 » for a ticked box. Empty and unticked read as "".
 */
export function readFields(fields: Iterable<FieldLike>): Map<string, string> {
  const values = new Map<string, string>();
  let i = 0;
  for (const f of fields) {
    const key = f.name || f.id || `#${i}`;
    i += 1;
    const boxed = f.type === "checkbox" || f.type === "radio";
    // Radios share a name: keep the one that is ticked.
    if (boxed) {
      if (f.checked) values.set(key, f.type === "radio" ? f.value : "1");
      else if (!values.has(key)) values.set(key, "");
    } else values.set(key, f.value);
  }
  return values;
}

/**
 * A field differs from where it started, or one present at the start is gone while it held
 * something. A field that appeared later starts from its own defaults (`start` gets them).
 */
export function differs(
  start: ReadonlyMap<string, string>,
  atStart: ReadonlyMap<string, string>,
  now: ReadonlyMap<string, string>,
): boolean {
  for (const [key, value] of now) if (value !== (start.get(key) ?? "")) return true;
  for (const [key, value] of atStart) if (!now.has(key) && value !== "") return true;
  return false;
}

const fieldsOf = (root: HTMLElement) =>
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(FIELDS);

/** What `holds` needs to decide, as `useUnsavedInput` keeps it. */
export type InputState = {
  /** No key pressed and no click yet: nothing can differ from what the person saw. */
  untouched: boolean;
  /** A value was picked in a list, calendar or menu. */
  picked: boolean;
  /** The container has a field someone can type in or choose. */
  editable: boolean;
  start: ReadonlyMap<string, string> | null;
  atStart: ReadonlyMap<string, string>;
  /** The fields as they are now (read only when needed). */
  now: () => ReadonlyMap<string, string>;
};

/**
 * Unsaved input: once touched, a pick in a list or calendar, or a field that differs.
 * Untouched means no gesture yet: a key handled before the first-touch listener (Escape,
 * Ctrl K in a panel, whose React capture handlers run first) compares nothing stale.
 */
export function holds({ untouched, picked, editable, start, atStart, now }: InputState): boolean {
  if (untouched || !editable || !start) return false;
  return picked || differs(start, atStart, now());
}

type Options = {
  /** Where the first key or click is listened for: the container by default (a panel passes its dialog). */
  touchRoot?: RefObject<HTMLElement | null>;
  /**
   * Where the form's lists, calendars and menus are rendered: a pick there may change state no
   * field shows (values kept in React), so it always counts as input. By default `[data-portal]`,
   * which matches any Mantine portal on the page, not only the form's: fine while the layout
   * itself portals no widget.
   */
  portal?: string;
  /** Off: no listener, no observer, never holds input (a full-page section rendered in a panel). */
  enabled?: boolean;
};

/**
 * Whether the form in `root` holds unsaved input (#251, #258): a field differs from what the
 * person saw before their first key or click, or a value was picked in a list or calendar.
 * Conservative on purpose: a false « input » only asks, a false « nothing » loses data.
 */
export function useUnsavedInput(
  root: RefObject<HTMLElement | null>,
  { touchRoot, portal = "[data-portal]", enabled = true }: Options = {},
) {
  /** Each field as it was before the first key or click, or when it appeared (a row or a guardian added). */
  const start = useRef<Map<string, string> | null>(null);
  /** The fields present at that moment: one removed since then with a value counts as input. */
  const atStart = useRef<Map<string, string>>(new Map());
  /**
   * The person has not pressed a key or clicked yet. A form may still fill its defaults in
   * its own effects, so the starting values are read again right before the first key or click.
   */
  const untouched = useRef(true);
  const picked = useRef(false);

  useEffect(() => {
    const r = root.current;
    if (!r || !enabled) return;
    const readStart = () => {
      start.current = readFields(fieldsOf(r));
      atStart.current = new Map(start.current);
    };
    readStart();
    const frame = requestAnimationFrame(() => untouched.current && readStart());
    const firstTouch = () => {
      if (!untouched.current) return;
      untouched.current = false;
      readStart();
    };
    const touch = touchRoot?.current ?? r;
    touch.addEventListener("pointerdown", firstTouch, true);
    touch.addEventListener("keydown", firstTouch, true);
    const pick = (e: Event) => {
      if (!(e.target instanceof Element && e.target.closest(portal))) return;
      // On a full page the portals sit outside the form: a pick there is a gesture too.
      firstTouch();
      picked.current = true;
    };
    document.addEventListener("pointerdown", pick, true);
    // A field that appears later starts from what it shows then (its defaults), not from empty.
    const watch = new MutationObserver(() => {
      const first = start.current;
      if (!first) return;
      for (const [key, value] of readFields(fieldsOf(r))) if (!first.has(key)) first.set(key, value);
    });
    watch.observe(r, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      touch.removeEventListener("pointerdown", firstTouch, true);
      touch.removeEventListener("keydown", firstTouch, true);
      document.removeEventListener("pointerdown", pick, true);
      watch.disconnect();
    };
  }, [root, touchRoot, portal, enabled]);

  return () => {
    const r = root.current;
    if (!r || !enabled) return false;
    return holds({
      untouched: untouched.current,
      picked: picked.current,
      editable: r.querySelector(EDITABLE) !== null,
      start: start.current,
      atStart: atStart.current,
      now: () => readFields(fieldsOf(r)),
    });
  };
}

/**
 * Reload, closing the tab or typing another address while `holdsInput()`: the browser asks
 * first (its own wording; pages cannot set it). `leaving` turns it off when the page goes on
 * purpose (« Abandonner » then a full-page load); `enabled: false` adds no listener at all.
 * A save redirects within the app, which fires no `beforeunload`, and the listener goes with
 * the form.
 */
export function useUnloadGuard(
  holdsInput: () => boolean,
  { leaving, enabled = true }: { leaving?: RefObject<boolean>; enabled?: boolean } = {},
) {
  const check = useRef(holdsInput);
  useEffect(() => {
    check.current = holdsInput;
  });
  useEffect(() => {
    if (!enabled) return;
    const guard = (e: BeforeUnloadEvent) => {
      if (leaving?.current || !check.current()) return;
      e.preventDefault();
      // Older browsers only ask when a value is set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [leaving, enabled]);
}
