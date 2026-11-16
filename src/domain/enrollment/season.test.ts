import { describe, expect, it } from "vitest";
import { enrollButtonLabel, enrollSeasonRefusal, mayEnrollIn } from "./season";

const past = { id: "p", label: "2025-2026", startDate: "2025-09-01" };
const current = { id: "c", label: "2026-2027", startDate: "2026-09-01" };
const next = { id: "n", label: "2027-2028", startDate: "2027-09-01" };

describe("mayEnrollIn (#376 Q1)", () => {
  it("allows the current season", () => {
    expect(mayEnrollIn(current, current)).toBe(true);
  });

  it("allows a later season: re-enrollments in June, before the next season starts", () => {
    expect(mayEnrollIn(next, current)).toBe(true);
  });

  it("refuses a past season", () => {
    expect(mayEnrollIn(past, current)).toBe(false);
  });
});

describe("enrollSeasonRefusal", () => {
  it("says nothing for the current or a later season", () => {
    expect(enrollSeasonRefusal(current, current)).toBeNull();
    expect(enrollSeasonRefusal(next, current)).toBeNull();
  });

  it("names the past season and the current one, in French", () => {
    expect(enrollSeasonRefusal(past, current)).toBe(
      "La saison 2025-2026 est passée : on inscrit en 2026-2027 ou dans une saison suivante.",
    );
  });
});

describe("enrollButtonLabel (#376)", () => {
  it("names the student alone on the current season", () => {
    expect(enrollButtonLabel("Zoé", current, current)).toBe("Inscrire Zoé");
  });

  it("names the later season shown, where the form enrolls", () => {
    expect(enrollButtonLabel("Zoé", next, current)).toBe("Inscrire Zoé en 2027-2028");
  });

  it("offers no button on a past season", () => {
    expect(enrollButtonLabel("Zoé", past, current)).toBeNull();
  });
});
