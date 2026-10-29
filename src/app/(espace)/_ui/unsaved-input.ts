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

type Options = {
  /** Where the first key or click is listened for: the container by default (a panel passes its dialog). */
  touchRoot?: RefObject<HTMLElement | null>;
  /**
   * Where the form's lists, calendars and menus are rendered: a pick there may change state no
   * field shows (values kept in React), so it always counts as input. Mantine's portals by default.
   */
  portal?: string;
};

/**
 * Whether the form in `root` holds unsaved input (#251, #258): a field differs from what the
 * person saw before their first key or click, or a value was picked in a list or calendar.
 * Conservative on purpose: a false « input » only asks, a false « nothing » loses data.
 */
export function useUnsavedInput(
  root: RefObject<HTMLElement | null>,
  { touchRoot, portal = "[data-portal]" }: Options = {},
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
    if (!r) return;
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
      if (e.target instanceof Element && e.target.closest(portal)) picked.current = true;
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
  }, [root, touchRoot, portal]);

  return () => {
    const r = root.current;
    const first = start.current;
    if (!r?.querySelector(EDITABLE) || !first) return false;
    return picked.current || differs(first, atStart.current, readFields(fieldsOf(r)));
  };
}

/**
 * Reload, closing the tab or typing another address while `holdsInput()`: the browser asks
 * first (its own wording; pages cannot set it). `leaving` turns it off when the page goes on
 * purpose (« Abandonner » then a full-page load). A save redirects within the app, which fires
 * no `beforeunload`, and the listener goes with the form.
 */
export function useUnloadGuard(holdsInput: () => boolean, leaving?: RefObject<boolean>) {
  const check = useRef(holdsInput);
  useEffect(() => {
    check.current = holdsInput;
  });
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (leaving?.current || !check.current()) return;
      e.preventDefault();
      // Older browsers only ask when a value is set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [leaving]);
}
