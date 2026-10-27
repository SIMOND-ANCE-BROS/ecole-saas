import { describe, expect, it } from "vitest";
import { parseTypedDate } from "./dates";

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
