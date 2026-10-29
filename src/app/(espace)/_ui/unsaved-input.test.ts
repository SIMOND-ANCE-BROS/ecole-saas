import { describe, expect, it } from "vitest";
import { differs, readFields, type FieldLike } from "./unsaved-input";

const text = (name: string, value: string): FieldLike => ({ name, id: "", value, type: "text" });
const box = (name: string, checked: boolean, value = "on", type = "checkbox"): FieldLike => ({
  name,
  id: "",
  value,
  type,
  checked,
});

describe("readFields", () => {
  it("keys fields by name, else id, else position", () => {
    const read = readFields([
      text("lastName", "Zz"),
      { name: "", id: "m-1", value: "a" },
      { name: "", id: "", value: "b" },
    ]);
    expect([...read]).toEqual([
      ["lastName", "Zz"],
      ["m-1", "a"],
      ["#2", "b"],
    ]);
  });

  it("reads a ticked box as « 1 » and an unticked one as empty", () => {
    expect(readFields([box("notify", true)]).get("notify")).toBe("1");
    expect(readFields([box("notify", false)]).get("notify")).toBe("");
  });

  it("keeps the ticked radio of a group, whatever its position", () => {
    const read = readFields([box("kind", false, "person", "radio"), box("kind", true, "organisation", "radio")]);
    expect(read.get("kind")).toBe("organisation");
  });
});

describe("differs", () => {
  const start = new Map([
    ["lastName", ""],
    ["kind", "person"],
  ]);

  it("is false when every field is back to where it started", () => {
    expect(differs(start, start, new Map(start))).toBe(false);
  });

  it("is true when a field changed", () => {
    expect(differs(start, start, new Map([...start, ["lastName", "Zz"]]))).toBe(true);
  });

  it("is true when a field present at the start and holding something is gone", () => {
    expect(differs(start, start, new Map([["lastName", ""]]))).toBe(true);
  });

  it("is false when an empty field present at the start is gone", () => {
    expect(differs(start, start, new Map([["kind", "person"]]))).toBe(false);
  });

  it("compares a field that appeared later with its own defaults, not with empty", () => {
    const withGuardian = new Map([...start, ["emergency", "1"]]);
    expect(differs(withGuardian, start, new Map(withGuardian))).toBe(false);
    expect(differs(withGuardian, start, new Map([...withGuardian, ["emergency", ""]]))).toBe(true);
  });

  it("counts a new field the start does not know as input once it holds something", () => {
    expect(differs(start, start, new Map([...start, ["phone", ""]]))).toBe(false);
    expect(differs(start, start, new Map([...start, ["phone", "06"]]))).toBe(true);
  });
});
