import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Autocomplete, MantineProvider, Select } from "@mantine/core";
import { describe, expect, it } from "vitest";
import { escapeCancels, listOpenOn, type AttributeReader } from "./escape-cancels";

type ListProps = { label: string; data: string[]; dropdownOpened: boolean };

/** The attributes Mantine really renders on the input of a list, open or closed. */
function input(control: ComponentType<ListProps>, open: boolean): AttributeReader {
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
  return { getAttribute: (name) => attributes.get(name) ?? null };
}

const attributes = (values: Record<string, string>): AttributeReader => ({
  getAttribute: (name) => values[name] ?? null,
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
    expect(listOpenOn(attributes({ "aria-expanded": "true" }))).toBe(true);
    expect(listOpenOn(attributes({ "aria-expanded": "false" }))).toBe(false);
    expect(listOpenOn(attributes({}))).toBe(false);
  });
});

describe("escapeCancels", () => {
  it("leaves the first Escape to an open list, cancels on the second", () => {
    expect(escapeCancels("Escape", false, input(Select as ComponentType<ListProps>, true))).toBe(false);
    expect(escapeCancels("Escape", false, input(Select as ComponentType<ListProps>, false))).toBe(true);
  });

  it("cancels from a plain field or without a target", () => {
    expect(escapeCancels("Escape", false, attributes({}))).toBe(true);
    expect(escapeCancels("Escape", false, null)).toBe(true);
  });

  it("ignores other keys and an Escape a control already handled", () => {
    expect(escapeCancels("Enter", false, attributes({}))).toBe(false);
    // The date field's calendar closes on Escape and prevents its default.
    expect(escapeCancels("Escape", true, attributes({}))).toBe(false);
  });
});
