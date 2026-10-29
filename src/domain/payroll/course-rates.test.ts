import { describe, expect, it } from "vitest";
import { formatEuros } from "../../lib/money";
import { courseRateEditable, courseRateSections, rateEditStart, rateEditUnchanged, shownRate } from "./course-rates";

const TODAY = "2026-10-29";
const hourly = { payMode: "hourly" as const, rateCents: 4000 };

describe("courseRateEditable (#276)", () => {
  it("lets the current and future seasons be edited, a season ended before today is history", () => {
    expect(courseRateEditable("2027-06-30", TODAY)).toBe(true);
    expect(courseRateEditable("2028-06-30", TODAY)).toBe(true);
    // Ending today: still the current season, in Paris.
    expect(courseRateEditable(TODAY, TODAY)).toBe(true);
    expect(courseRateEditable("2026-10-28", TODAY)).toBe(false);
  });
});

describe("courseRateSections (#276)", () => {
  it("lists every current or future course, and only the past ones with a rate of their own, in order", () => {
    const courses = [
      { id: "future", seasonEndDate: "2028-06-30", rate: null },
      { id: "current-own", seasonEndDate: "2027-06-30", rate: { cents: 4550, payMode: "hourly" as const } },
      { id: "current-usual", seasonEndDate: "2027-06-30", rate: null },
      { id: "past-own", seasonEndDate: "2026-06-30", rate: { cents: 3000, payMode: "per_lesson" as const } },
      { id: "past-usual", seasonEndDate: "2026-06-30", rate: null },
    ];
    const { editable, history } = courseRateSections(courses, TODAY);
    expect(editable.map((c) => c.id)).toEqual(["future", "current-own", "current-usual"]);
    expect(history.map((c) => c.id)).toEqual(["past-own"]);
  });

  it("gives two empty lists for an instructor without courses", () => {
    expect(courseRateSections([], TODAY)).toEqual({ editable: [], history: [] });
  });
});

describe("shownRate (#276)", () => {
  it("names the usual rate with its unit when the course has none", () => {
    expect(shownRate(null, hourly)).toEqual({
      label: `tarif habituel (${formatEuros(4000)} / heure)`,
      note: null,
      usual: true,
    });
    expect(shownRate(null, { payMode: "per_lesson", rateCents: 2500 }).label).toBe(
      `tarif habituel (${formatEuros(2500)} / séance)`,
    );
  });

  it("shows the course's own rate in the unit it was typed in", () => {
    expect(shownRate({ cents: 4550, payMode: "hourly" }, hourly)).toEqual({
      label: `${formatEuros(4550)} / heure`,
      note: null,
      usual: false,
    });
  });

  it("says when the own rate is an older pay mode's, without reading it in the new unit (#268)", () => {
    expect(shownRate({ cents: 3000, payMode: "per_lesson" }, hourly)).toEqual({
      label: `${formatEuros(3000)} / séance`,
      note: "ancien mode de rémunération",
      usual: false,
    });
  });

  it("says a rate per course is not applied to a monthly flat instructor (#192)", () => {
    const flat = { payMode: "monthly_flat" as const, rateCents: 120000 };
    expect(shownRate({ cents: 3000, payMode: "hourly" }, flat)).toEqual({
      label: `${formatEuros(3000)} / heure`,
      note: "non appliqué (forfait mensuel)",
      usual: false,
    });
    // Stored with no unit of its own: the label already says it is not used.
    expect(shownRate({ cents: 3000, payMode: "monthly_flat" }, flat)).toEqual({
      label: `${formatEuros(3000)}, tarif non utilisé (forfait mensuel)`,
      note: null,
      usual: false,
    });
  });
});

describe("rateEditStart (#276)", () => {
  it("starts from the own rate in the current unit, empty for the usual rate", () => {
    expect(rateEditStart({ cents: 4550, payMode: "hourly" }, "hourly")).toBe("45,50");
    expect(rateEditStart({ cents: 4500, payMode: "hourly" }, "hourly")).toBe("45");
    expect(rateEditStart(null, "hourly")).toBe("");
  });

  it("starts empty for an older unit's rate, never re-typing it in the new unit (#268)", () => {
    expect(rateEditStart({ cents: 3000, payMode: "per_lesson" }, "hourly")).toBe("");
  });
});

describe("rateEditUnchanged (#276)", () => {
  it("sees the same amount however it is typed", () => {
    expect(rateEditUnchanged("45,50", "45,5")).toBe(true);
    expect(rateEditUnchanged("45", " 45,00 ")).toBe(true);
    expect(rateEditUnchanged("", "  ")).toBe(true);
  });

  it("sees a new amount, a cleared one, a first one and an unreadable one as changes", () => {
    expect(rateEditUnchanged("45,50", "46")).toBe(false);
    expect(rateEditUnchanged("45,50", "")).toBe(false);
    expect(rateEditUnchanged("", "45")).toBe(false);
    expect(rateEditUnchanged("45", "abc")).toBe(false);
  });
});
