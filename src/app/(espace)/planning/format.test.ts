import { describe, expect, it } from "vitest";
import { recurrenceBadge, recurrenceText } from "./format";

const c = { recurrence: "weekly" as const, weekday: 1, startDate: null, endDate: null, dates: [] };

describe("recurrenceText", () => {
  it("describes each recurrence", () => {
    expect(recurrenceText(c)).toBe("Chaque lundi");
    expect(recurrenceText({ ...c, recurrence: "biweekly", weekday: 3 })).toBe("Un mercredi sur deux");
    expect(recurrenceText({ ...c, startDate: "2026-11-01", endDate: "2026-11-17" })).toBe(
      "Chaque lundi, du 1 nov. au 17 nov.",
    );
    expect(recurrenceText({ ...c, endDate: "2027-06-20" })).toBe("Chaque lundi, jusqu’au 20 juin");
    expect(recurrenceText({ ...c, recurrence: "dates", weekday: null, dates: ["2026-10-24", "2026-10-25"] })).toBe(
      "Le sam. 24 oct., le dim. 25 oct.",
    );
  });

  it("recurrenceBadge only when it is not « chaque semaine, toute la saison »", () => {
    expect(recurrenceBadge(c)).toBeNull();
    expect(recurrenceBadge({ ...c, recurrence: "biweekly" })).toBe("1 sem. sur 2");
    expect(recurrenceBadge({ ...c, startDate: "2026-11-01" })).toBe("1 nov. → …");
  });
});
