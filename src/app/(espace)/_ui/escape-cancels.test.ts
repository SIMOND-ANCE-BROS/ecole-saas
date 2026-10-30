import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Autocomplete, MantineProvider, Select } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";
import { cancelOnEscape, escapeCancels, escapeOutcome, listOpenOn, type EscapeTarget } from "./escape-cancels";

type ListProps = { label: string; data: string[]; dropdownOpened: boolean };

/** The attributes Mantine really renders on the input of a list, open or closed (outside any portal). */
function input(control: ComponentType<ListProps>, open: boolean): EscapeTarget {
  const html = renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(control, { label: "Zz", data: ["A", "B"], dropdownOpened: open }),
    ),
  );
  const tag = html.match(/<input [^>]*mantine-(?:Select|Autocomplete)-input[^>]*>/)?.[0];
  if (!tag) throw new Error("no list input rendered");
  const attributes = new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
  return { getAttribute: (name) => attributes.get(name) ?? null, closest: () => null };
}

/** A field with these attributes, inside the portals matched by `inPortal` (none by default). */
const element = (values: Record<string, string>, inPortal: (selectors: string) => boolean = () => false) => ({
  getAttribute: (name: string) => values[name] ?? null,
  closest: (selectors: string) => (inPortal(selectors) ? {} : null),
});

describe("listOpenOn", () => {
  it("sees an open Mantine Select or Autocomplete, which set no aria-expanded", () => {
    for (const control of [Select, Autocomplete] as ComponentType<ListProps>[]) {
      const open = input(control, true);
      // The former guard read only this attribute: Escape closed the whole form.
      expect(open.getAttribute("aria-expanded")).not.toBe("true");
      expect(listOpenOn(open)).toBe(true);
      expect(listOpenOn(input(control, false))).toBe(false);
    }
  });

  it("still reads aria-expanded on other controls", () => {
    expect(listOpenOn(element({ "aria-expanded": "true" }))).toBe(true);
    expect(listOpenOn(element({ "aria-expanded": "false" }))).toBe(false);
    expect(listOpenOn(element({}))).toBe(false);
  });

  it("sees a key pressed inside a dropdown or dialog, in the page's portals or the panel's", () => {
    const inMenu = element({}, (s) => s === "[data-portal]");
    expect(listOpenOn(inMenu)).toBe(true);
    // The side panel renders its lists into its own portal.
    const inPanelList = element({}, (s) => s === "#panneau-portail");
    expect(listOpenOn(inPanelList, "#panneau-portail")).toBe(true);
    expect(listOpenOn(inPanelList)).toBe(false);
  });
});

describe("escapeCancels", () => {
  it("leaves the first Escape to an open list, cancels on the second", () => {
    expect(escapeCancels("Escape", false, input(Select as ComponentType<ListProps>, true))).toBe(false);
    expect(escapeCancels("Escape", false, input(Select as ComponentType<ListProps>, false))).toBe(true);
  });

  it("cancels from a plain field or without a target", () => {
    expect(escapeCancels("Escape", false, element({}))).toBe(true);
    expect(escapeCancels("Escape", false, null)).toBe(true);
  });

  it("ignores other keys and an Escape a control already handled", () => {
    expect(escapeCancels("Enter", false, element({}))).toBe(false);
    // A control that already handled Escape prevents its default.
    expect(escapeCancels("Escape", true, element({}))).toBe(false);
  });
});

describe("escapeOutcome", () => {
  const typed = () => true;
  const untouched = () => false;

  it("asks before dropping typed input, leaves an untouched form at once", () => {
    expect(escapeOutcome("Escape", false, element({}), typed)).toBe("ask");
    expect(escapeOutcome("Escape", false, element({}), untouched)).toBe("leave");
  });

  it("does nothing while a list takes the Escape, nor on another key", () => {
    expect(escapeOutcome("Escape", false, element({ "data-expanded": "true" }), typed)).toBe("none");
    expect(escapeOutcome("Enter", false, element({}), typed)).toBe("none");
  });

  it("does not read the input when Escape does not leave", () => {
    const holds = vi.fn(() => true);
    escapeOutcome("Escape", false, element({ "data-expanded": "true" }), holds);
    expect(holds).not.toHaveBeenCalled();
  });
});

describe("cancelOnEscape", () => {
  const escape = () => ({ key: "Escape", defaultPrevented: false, target: null, preventDefault: vi.fn() });

  it("asks instead of closing when the form holds typed input (#339)", () => {
    const close = vi.fn();
    const ask = vi.fn();
    const e = escape();
    cancelOnEscape(close, { holdsInput: () => true, ask })(e);
    // Before #339, Escape closed the form at once and lost what was typed.
    expect(close).not.toHaveBeenCalled();
    expect(ask).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("closes an untouched form at once", () => {
    const close = vi.fn();
    const ask = vi.fn();
    cancelOnEscape(close, { holdsInput: () => false, ask })(escape());
    expect(close).toHaveBeenCalledOnce();
    expect(ask).not.toHaveBeenCalled();
  });

  it("leaves other keys alone", () => {
    const close = vi.fn();
    const ask = vi.fn();
    const e = { ...escape(), key: "a" };
    cancelOnEscape(close, { holdsInput: () => true, ask })(e);
    expect(close).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
