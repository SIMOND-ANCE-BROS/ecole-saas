import { describe, expect, it } from "vitest";
import { enrollButtonLabel, enrollSeasonRefusal, mayEnrollIn } from "./season";

const past = { id: "p", label: "2025-2026", endDate: "2026-06-30" };
const current = { id: "c", label: "2026-2027", endDate: "2027-06-30" };
const next = { id: "n", label: "2027-2028", endDate: "2028-06-30" };
const afterNext = { id: "a", label: "2028-2029", endDate: "2029-06-30" };
const TODAY = "2027-06-20";

describe("mayEnrollIn (#376 Q1)", () => {
  it("allows the current season", () => {
    expect(mayEnrollIn(current, current, TODAY)).toBe(true);
  });

  it("allows a later season: re-enrollments in June, before the next season starts", () => {
    expect(mayEnrollIn(next, current, TODAY)).toBe(true);
  });

  it("refuses a past season", () => {
    expect(mayEnrollIn(past, current, TODAY)).toBe(false);
  });

  it("keeps the season about to start open in the summer gap, when the latest season counts as current", () => {
    // 10 July: 2026-2027 has ended, `currentSeason` falls back to 2028-2029, created ahead.
    expect(mayEnrollIn(next, afterNext, "2027-07-10")).toBe(true);
    expect(mayEnrollIn(current, afterNext, "2027-07-10")).toBe(false);
  });

  it("allows the current season even once ended, when it is the latest one (summer, nothing created yet)", () => {
    expect(mayEnrollIn(current, current, "2027-07-10")).toBe(true);
  });
});

describe("enrollSeasonRefusal", () => {
  it("says nothing for the current or a later season", () => {
    expect(enrollSeasonRefusal(current, current, TODAY)).toBeNull();
    expect(enrollSeasonRefusal(next, current, TODAY)).toBeNull();
  });

  it("names the past season and the current one, in French", () => {
    expect(enrollSeasonRefusal(past, current, TODAY)).toBe(
      "La saison 2025-2026 est terminée : les inscriptions se font en 2026-2027 ou dans une saison suivante.",
    );
  });
});

describe("enrollButtonLabel (#376)", () => {
  it("names the student alone on the current season", () => {
    expect(enrollButtonLabel("Zoé", current, current, TODAY)).toBe("Inscrire Zoé");
  });

  it("names the later season shown, where the form enrolls", () => {
    expect(enrollButtonLabel("Zoé", next, current, TODAY)).toBe("Inscrire Zoé en 2027-2028");
  });

  it("offers no button on a past season", () => {
    expect(enrollButtonLabel("Zoé", past, current, TODAY)).toBeNull();
  });
});
