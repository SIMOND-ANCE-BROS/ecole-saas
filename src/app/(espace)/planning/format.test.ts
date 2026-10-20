import { describe, expect, it } from "vitest";
import { marqueRecurrence, recurrenceTexte } from "./format";

const c = { recurrence: "hebdomadaire" as const, jourSemaine: 1, dateDebut: null, dateFin: null, dates: [] };

describe("recurrenceTexte", () => {
  it("décrit chaque récurrence", () => {
    expect(recurrenceTexte(c)).toBe("Chaque lundi");
    expect(recurrenceTexte({ ...c, recurrence: "quinzaine", jourSemaine: 3 })).toBe("Un mercredi sur deux");
    expect(recurrenceTexte({ ...c, dateDebut: "2026-11-01", dateFin: "2026-11-17" })).toBe("Chaque lundi, du 1 nov. au 17 nov.");
    expect(recurrenceTexte({ ...c, dateFin: "2027-06-20" })).toBe("Chaque lundi, jusqu’au 20 juin");
    expect(recurrenceTexte({ ...c, recurrence: "dates", jourSemaine: null, dates: ["2026-10-24", "2026-10-25"] })).toBe("Le sam. 24 oct., le dim. 25 oct.");
  });

  it("étiquette de l'agenda seulement si ce n'est pas « chaque semaine, toute la saison »", () => {
    expect(marqueRecurrence(c)).toBeNull();
    expect(marqueRecurrence({ ...c, recurrence: "quinzaine" })).toBe("1 sem. sur 2");
    expect(marqueRecurrence({ ...c, dateDebut: "2026-11-01" })).toBe("1 nov. → …");
  });
});
