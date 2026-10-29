import { describe, expect, it } from "vitest";
import { frenchList } from "./french-list";

describe("frenchList", () => {
  it("gives nothing for no item", () => {
    expect(frenchList([])).toBe("");
  });

  it("gives a single item as is", () => {
    expect(frenchList(["2026-2027"])).toBe("2026-2027");
  });

  it("joins two items with « et »", () => {
    expect(frenchList(["2026-2027", "2027-2028"])).toBe("2026-2027 et 2027-2028");
  });

  it("separates the first items with commas and the last with « et »", () => {
    expect(frenchList(["2025-2026", "2026-2027", "2027-2028"])).toBe("2025-2026, 2026-2027 et 2027-2028");
  });
});
