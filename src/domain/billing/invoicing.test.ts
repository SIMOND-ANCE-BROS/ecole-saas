import { describe, expect, it } from "vitest";
import { numberFitsTool } from "./invoicing";

describe("numberFitsTool", () => {
  it("accepts a « TEST- » number from the fake tool only", () => {
    expect(numberFitsTool("fake", "TEST-F-1A2B")).toBe(true);
    expect(numberFitsTool("pennylane", "TEST-F-1A2B")).toBe(false);
  });

  it("accepts real numbers from real tools only", () => {
    expect(numberFitsTool("abby", "F-2027-001")).toBe(true);
    expect(numberFitsTool("fake", "F-2027-001")).toBe(false);
  });
});
