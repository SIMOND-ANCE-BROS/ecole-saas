import { describe, expect, it } from "vitest";
import { ageAt, todayInParis } from "./age";

describe("ageAu", () => {
  it("compte les années révolues", () => {
    expect(ageAt("2015-03-10", "2026-10-19")).toBe(11);
  });

  it("n’ajoute l’année qu’à partir du jour anniversaire", () => {
    expect(ageAt("2015-10-20", "2026-10-19")).toBe(10);
    expect(ageAt("2015-10-19", "2026-10-19")).toBe(11);
  });

  it("gère un anniversaire un 29 février", () => {
    expect(ageAt("2016-02-29", "2027-02-28")).toBe(10);
    expect(ageAt("2016-02-29", "2027-03-01")).toBe(11);
  });
});

describe("aujourdhuiAParis", () => {
  it("donne la date du jour à Paris, pas en UTC", () => {
    // 23 h 30 UTC le 19 octobre = 1 h 30 le 20 octobre à Paris (heure d’été).
    expect(todayInParis(new Date("2026-10-19T23:30:00Z"))).toBe("2026-10-20");
    // 23 h 30 UTC le 19 décembre = 0 h 30 le 20 décembre à Paris (heure d’hiver).
    expect(todayInParis(new Date("2026-12-19T23:30:00Z"))).toBe("2026-12-20");
    expect(todayInParis(new Date("2026-12-19T22:30:00Z"))).toBe("2026-12-19");
  });
});
