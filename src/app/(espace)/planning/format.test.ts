import { describe, expect, it } from "vitest";
import { recurrenceBadge, recurrenceText } from "./format";

const c = { recurrence: "hebdomadaire" as const, weekday: 1, startDate: null, endDate: null, dates: [] };

describe("recurrenceTexte", () => {
  it("décrit chaque récurrence", () => {
    expect(recurrenceText(c)).toBe("Chaque lundi");
    expect(recurrenceText({ ...c, recurrence: "quinzaine", weekday: 3 })).toBe("Un mercredi sur deux");
    expect(recurrenceText({ ...c, startDate: "2026-11-01", endDate: "2026-11-17" })).toBe(
      "Chaque lundi, du 1 nov. au 17 nov.",
    );
    expect(recurrenceText({ ...c, endDate: "2027-06-20" })).toBe("Chaque lundi, jusqu’au 20 juin");
    expect(recurrenceText({ ...c, recurrence: "dates", weekday: null, dates: ["2026-10-24", "2026-10-25"] })).toBe(
      "Le sam. 24 oct., le dim. 25 oct.",
    );
  });

  it("étiquette de l'agenda seulement si ce n'est pas « chaque semaine, toute la saison »", () => {
    expect(recurrenceBadge(c)).toBeNull();
    expect(recurrenceBadge({ ...c, recurrence: "quinzaine" })).toBe("1 sem. sur 2");
    expect(recurrenceBadge({ ...c, startDate: "2026-11-01" })).toBe("1 nov. → …");
  });
});
