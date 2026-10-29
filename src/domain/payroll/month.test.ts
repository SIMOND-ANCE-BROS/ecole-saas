import { describe, expect, it } from "vitest";
import { monthBounds, monthLabel, monthOf, ofMonth, shiftMonth, validMonth } from "./month";

describe("validMonth", () => {
  it("accepts a YYYY-MM month", () => {
    expect(validMonth("2027-10")).toBe("2027-10");
  });

  it("refuses anything else", () => {
    for (const v of ["2027-13", "2027-00", "2027-1", "27-10", "2027-10-01", "", undefined, ["2027-10"], "1999-12"])
      expect(validMonth(v)).toBeNull();
  });
});

describe("monthBounds", () => {
  it("gives the first and last day, leap years included", () => {
    expect(monthBounds("2027-10")).toEqual({ first: "2027-10-01", last: "2027-10-31" });
    expect(monthBounds("2028-02")).toEqual({ first: "2028-02-01", last: "2028-02-29" });
    expect(monthBounds("2027-02")).toEqual({ first: "2027-02-01", last: "2027-02-28" });
  });
});

describe("shiftMonth", () => {
  it("moves across years both ways", () => {
    expect(shiftMonth("2027-12", 1)).toBe("2028-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2027-10", 0)).toBe("2027-10");
  });
});

describe("monthOf and monthLabel", () => {
  it("reads the month of a date and names it in French", () => {
    expect(monthOf("2027-10-29")).toBe("2027-10");
    expect(monthLabel("2027-10")).toBe("octobre 2027");
  });

  it("elides « de » before a vowel", () => {
    expect(ofMonth("2027-10")).toBe("d’octobre 2027");
    expect(ofMonth("2027-04")).toBe("d’avril 2027");
    expect(ofMonth("2027-08")).toBe("d’août 2027");
    expect(ofMonth("2027-09")).toBe("de septembre 2027");
  });
});
