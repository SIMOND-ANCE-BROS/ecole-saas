import { describe, expect, it } from "vitest";
import { ageAt, todayInParis } from "./age";

describe("ageAt", () => {
  it("counts full years", () => {
    expect(ageAt("2015-03-10", "2026-10-19")).toBe(11);
  });

  it("adds the year only from the birthday onwards", () => {
    expect(ageAt("2015-10-20", "2026-10-19")).toBe(10);
    expect(ageAt("2015-10-19", "2026-10-19")).toBe(11);
  });

  it("handles a birthday on 29 February", () => {
    expect(ageAt("2016-02-29", "2027-02-28")).toBe(10);
    expect(ageAt("2016-02-29", "2027-03-01")).toBe(11);
  });
});

describe("todayInParis", () => {
  it("gives today's date in Paris, not in UTC", () => {
    // 23:30 UTC on 19 October = 01:30 on 20 October in Paris (summer time).
    expect(todayInParis(new Date("2026-10-19T23:30:00Z"))).toBe("2026-10-20");
    // 23:30 UTC on 19 December = 00:30 on 20 December in Paris (winter time).
    expect(todayInParis(new Date("2026-12-19T23:30:00Z"))).toBe("2026-12-20");
    expect(todayInParis(new Date("2026-12-19T22:30:00Z"))).toBe("2026-12-19");
  });
});
