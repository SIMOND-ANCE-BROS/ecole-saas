import { describe, expect, it } from "vitest";
import { addDays, validDate, weekDays, weekdayOf, mondayOf } from "./week";

describe("weeks", () => {
  it("weekday and Monday, including on the clock change", () => {
    expect(weekdayOf("2026-10-19")).toBe(1);
    expect(weekdayOf("2026-10-25")).toBe(7); // switch to winter time
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });

  it("days of the week and offsets", () => {
    expect(weekDays("2026-12-28")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    expect(addDays("2026-10-19", -7)).toBe("2026-10-12");
  });

  it("valid URL date", () => {
    expect(validDate("2026-10-19")).toBe("2026-10-19");
    expect(validDate("2026-02-30")).toBeNull();
    expect(validDate("19/10/2026")).toBeNull();
    expect(validDate(["2026-10-19"])).toBeNull();
  });
});
