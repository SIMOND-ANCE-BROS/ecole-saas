import { describe, expect, it } from "vitest";
import { frenchDate, parseTypedDate, typedDateRefusal } from "./dates";

describe("parseTypedDate", () => {
  it("reads a French date, with or without leading zeros and with the usual separators", () => {
    expect(parseTypedDate("12/09/2027")).toBe("2027-09-12");
    expect(parseTypedDate(" 1/9/2027 ")).toBe("2027-09-01");
    expect(parseTypedDate("01.09.2027")).toBe("2027-09-01");
    expect(parseTypedDate("01-09-2027")).toBe("2027-09-01");
  });

  it("reads a two-digit year as 20xx, and eight digits without separators", () => {
    expect(parseTypedDate("1/9/27")).toBe("2027-09-01");
    expect(parseTypedDate("12092027")).toBe("2027-09-12");
    expect(parseTypedDate("1209202")).toBeNull();
  });

  it("accepts a pasted ISO date", () => {
    expect(parseTypedDate("2027-09-12")).toBe("2027-09-12");
  });

  it("waits for a complete date instead of guessing", () => {
    expect(parseTypedDate("12/09/2")).toBeNull();
    expect(parseTypedDate("12/09/202")).toBeNull();
    expect(parseTypedDate("12/09")).toBeNull();
    expect(parseTypedDate("")).toBeNull();
  });

  it("refuses a day that does not exist, and keeps 29 February of leap years", () => {
    expect(parseTypedDate("31/02/2027")).toBeNull();
    expect(parseTypedDate("29/02/2027")).toBeNull();
    expect(parseTypedDate("29/02/2028")).toBe("2028-02-29");
    expect(parseTypedDate("31/04/2027")).toBeNull();
    expect(parseTypedDate("00/09/2027")).toBeNull();
    expect(parseTypedDate("12/13/2027")).toBeNull();
  });
});

describe("typedDateRefusal", () => {
  it("accepts an empty field and a readable date inside the bounds, bounds included", () => {
    expect(typedDateRefusal("", "2027-09-01", "2028-06-30")).toBeNull();
    expect(typedDateRefusal("1/9/27", "2027-09-01", "2028-06-30")).toBeNull();
    expect(typedDateRefusal("30/06/2028", "2027-09-01", "2028-06-30")).toBeNull();
    expect(typedDateRefusal("12/09/2027", null, null)).toBeNull();
  });

  it("explains an unreadable date", () => {
    expect(typedDateRefusal("31/02/2027", null, null)).toBe("Date non reconnue : tapez jj/mm/aaaa");
  });

  it("names the allowed period for a date outside it", () => {
    expect(typedDateRefusal("31/08/2027", "2027-09-01", "2028-06-30")).toBe(
      "Choisissez une date du 1 sept. 2027 au 30 juin 2028",
    );
    expect(typedDateRefusal("01/07/2028", "2027-09-01", null)).toBeNull();
    expect(typedDateRefusal("31/08/2027", "2027-09-01", null)).toBe("Choisissez une date à partir du 1 sept. 2027");
    expect(typedDateRefusal("01/07/2028", null, "2028-06-30")).toBe("Choisissez une date jusqu’au 30 juin 2028");
  });
});

describe("frenchDate", () => {
  it("shows a stored date as day/month/year", () => {
    expect(frenchDate("2026-10-21")).toBe("21/10/2026");
    expect(frenchDate("2027-01-05")).toBe("05/01/2027");
  });

  it("keeps only the day of a timestamp", () => {
    expect(frenchDate("2026-10-21T08:30:00.000Z")).toBe("21/10/2026");
    expect(frenchDate("2026-10-21 08:30:00")).toBe("21/10/2026");
  });

  it("reads an empty or partial value as before", () => {
    expect(frenchDate("")).toBe("");
    expect(frenchDate("2026-10")).toBe("10/2026");
  });

  it("returns a tampered value unchanged rather than a clean date", () => {
    expect(frenchDate("2026-10-21xyz")).toBe("2026-10-21xyz");
  });
});
