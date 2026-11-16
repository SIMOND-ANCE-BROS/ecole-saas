import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSTALLMENT_PLANS,
  firstDueDate,
  noDueDayLeft,
  planLabel,
  planSchedule,
  planSettingRefusal,
  plansThatFit,
  type InstallmentPlanSetting,
} from "./plans";

/** The owner's decision (#176, 2026-11-15): 1, 3 or 10 installments, on the 5th, to the euro. */
const RIBAS: InstallmentPlanSetting = { counts: [1, 3, 10], dueDay: 5, roundingUnitCents: 100 };
const SEASON = { startDate: "2027-09-01", endDate: "2028-06-30" };
const at = (today: string) => ({ season: SEASON, today });

describe("firstDueDate", () => {
  it("is the due day of the month when it is still ahead, else the next month's", () => {
    expect(firstDueDate("2027-09-01", 5)).toBe("2027-09-05");
    expect(firstDueDate("2027-09-05", 5)).toBe("2027-09-05");
    expect(firstDueDate("2027-09-06", 5)).toBe("2027-10-05");
    expect(firstDueDate("2027-12-20", 5)).toBe("2028-01-05");
  });
});

describe("plansThatFit", () => {
  it("offers every plan drafted before the season starts", () => {
    expect(plansThatFit(RIBAS, at("2027-06-20"))).toEqual([1, 3, 10]);
  });

  it("drops 10 installments once they would end after the season (#176 Q3)", () => {
    // From 5 October, 10 installments end on 5 July 2028, after 30 June.
    expect(plansThatFit(RIBAS, at("2027-09-06"))).toEqual([1, 3]);
  });

  it("a plan starting mid-season keeps what still fits", () => {
    expect(plansThatFit(RIBAS, at("2028-03-10"))).toEqual([1, 3]);
    expect(plansThatFit(RIBAS, at("2028-05-10"))).toEqual([1]);
  });

  it("an ended season gets one installment (#380 Q2)", () => {
    expect(plansThatFit(RIBAS, at("2028-07-15"))).toEqual([1]);
  });
});

describe("a draft made before the season starts (#436)", () => {
  // A season starting after the due day of its first month: 13 September, due on the 5th.
  const LATE_START = { startDate: "2027-09-13", endDate: "2028-06-30" };
  const before = (today: string) => ({ season: LATE_START, today });

  it("starts the plan on the due day of the season's first month, even before the start day", () => {
    const r = planSchedule({ amountCents: 41500, count: 3, setting: RIBAS, window: before("2027-06-20") });
    if (!r.ok) throw new Error(r.message);
    expect(r.installments.map((i) => i.dueOn)).toEqual(["2027-09-05", "2027-10-05", "2027-11-05"]);
  });

  it("still offers 10 installments, September to June, within the season", () => {
    expect(plansThatFit(RIBAS, before("2027-06-20"))).toEqual([1, 3, 10]);
    const r = planSchedule({ amountCents: 64500, count: 10, setting: RIBAS, window: before("2027-06-20") });
    if (!r.ok) throw new Error(r.message);
    expect(r.installments.map((i) => i.dueOn)).toEqual([
      "2027-09-05",
      "2027-10-05",
      "2027-11-05",
      "2027-12-05",
      "2028-01-05",
      "2028-02-05",
      "2028-03-05",
      "2028-04-05",
      "2028-05-05",
      "2028-06-05",
    ]);
  });

  it("never dates an installment before the day of the drafting", () => {
    // Drafted on 8 September, before the 13th: the 5th has passed, the plan starts on 5 October.
    const r = planSchedule({ amountCents: 30000, count: 3, setting: RIBAS, window: before("2027-09-08") });
    if (!r.ok) throw new Error(r.message);
    expect(r.installments[0].dueOn).toBe("2027-10-05");
    expect(plansThatFit(RIBAS, before("2027-09-08"))).toEqual([1, 3]);
  });

  it("a season ending early still caps the plan: no count runs past its end", () => {
    const short = { season: { startDate: "2027-09-13", endDate: "2028-01-31" }, today: "2027-06-20" };
    expect(plansThatFit(RIBAS, short)).toEqual([1, 3]);
  });

  it("a draft once the season started keeps the next due day (unchanged)", () => {
    expect(plansThatFit(RIBAS, before("2027-09-20"))).toEqual([1, 3]);
    const r = planSchedule({ amountCents: 30000, count: 3, setting: RIBAS, window: before("2027-09-20") });
    if (!r.ok) throw new Error(r.message);
    expect(r.installments[0].dueOn).toBe("2027-10-05");
  });
});

describe("noDueDayLeft", () => {
  it("is true only once the season has no due day left", () => {
    expect(noDueDayLeft(RIBAS, at("2028-06-05"))).toBe(false);
    expect(noDueDayLeft(RIBAS, at("2028-06-06"))).toBe(true);
  });
});

describe("planSchedule", () => {
  const plan = (amountCents: number, count: number, today = "2027-06-20", setting = RIBAS) =>
    planSchedule({ amountCents, count, setting, window: at(today) });

  it("splits a yearly package into 3 cheques on the 5th, to the euro, remainder on the first", () => {
    expect(plan(41500, 3)).toEqual({
      ok: true,
      installments: [
        { dueOn: "2027-09-05", amountCents: 13900 },
        { dueOn: "2027-10-05", amountCents: 13800 },
        { dueOn: "2027-11-05", amountCents: 13800 },
      ],
    });
  });

  it("three siblings at −10 %: the cents left over go on the first installment", () => {
    // Three yearly packages of 415,00 € − 10 % = 3 × 373,50 € = 1 120,50 €.
    const r = plan(3 * 37350, 3);
    if (!r.ok) throw new Error(r.message);
    expect(r.installments.map((i) => i.amountCents)).toEqual([37450, 37300, 37300]);
    expect(r.installments.reduce((s, i) => s + i.amountCents, 0)).toBe(112050);
  });

  it("10 installments run from September to June", () => {
    const r = plan(64501, 10);
    if (!r.ok) throw new Error(r.message);
    expect(r.installments.map((i) => i.dueOn)).toEqual([
      "2027-09-05",
      "2027-10-05",
      "2027-11-05",
      "2027-12-05",
      "2028-01-05",
      "2028-02-05",
      "2028-03-05",
      "2028-04-05",
      "2028-05-05",
      "2028-06-05",
    ]);
    expect(r.installments[0].amountCents).toBe(6901);
  });

  it("refuses 10 installments that do not fit the season", () => {
    expect(plan(64500, 10, "2027-11-12")).toEqual({
      ok: false,
      message: "Le paiement en 10 fois finirait après la fin de la saison : choisissez moins d’échéances.",
    });
  });

  it("a plan starting mid-season begins at the next due day", () => {
    const r = plan(30000, 3, "2028-02-14");
    if (!r.ok) throw new Error(r.message);
    expect(r.installments.map((i) => i.dueOn)).toEqual(["2028-03-05", "2028-04-05", "2028-05-05"]);
  });

  it("an ended season's single installment is dated today (#380 Q2)", () => {
    expect(plan(41500, 1, "2028-08-20")).toEqual({
      ok: true,
      installments: [{ dueOn: "2028-08-20", amountCents: 41500 }],
    });
  });

  it("an ended season still gets its single installment when the school offers no one-off plan", () => {
    const r = plan(41500, 1, "2028-08-20", { ...RIBAS, counts: [3, 10] });
    expect(r).toEqual({ ok: true, installments: [{ dueOn: "2028-08-20", amountCents: 41500 }] });
  });

  it("refuses a count the school does not offer", () => {
    expect(plan(41500, 4).ok).toBe(false);
  });

  it("refuses an amount too small for euro installments", () => {
    const r = plan(250, 3);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/ne se partagent pas en 3 échéances/);
  });

  it("nothing to split gives no installment", () => {
    expect(plan(0, 3)).toEqual({ ok: true, installments: [] });
  });

  it("the default setting: one installment, to the cent", () => {
    expect(plan(41550, 1, "2027-06-20", DEFAULT_INSTALLMENT_PLANS)).toEqual({
      ok: true,
      installments: [{ dueOn: "2027-09-01", amountCents: 41550 }],
    });
  });
});

describe("planSettingRefusal", () => {
  it("accepts the owner's setting and the edges: 12 installments, the 28th", () => {
    expect(planSettingRefusal(RIBAS)).toBeNull();
    expect(planSettingRefusal({ counts: [12], dueDay: 28, roundingUnitCents: 1 })).toBeNull();
  });

  it("refuses no plan, a count out of range, a duplicate, a due day past the 28th and an unknown rounding", () => {
    expect(planSettingRefusal({ ...RIBAS, counts: [] })).not.toBeNull();
    expect(planSettingRefusal({ ...RIBAS, counts: [0] })).not.toBeNull();
    expect(planSettingRefusal({ ...RIBAS, counts: [13] })).not.toBeNull();
    expect(planSettingRefusal({ ...RIBAS, counts: [3, 3] })).not.toBeNull();
    expect(planSettingRefusal({ ...RIBAS, dueDay: 29 })).not.toBeNull();
    expect(planSettingRefusal({ ...RIBAS, dueDay: 0 })).not.toBeNull();
    expect(planSettingRefusal({ ...RIBAS, roundingUnitCents: 50 })).not.toBeNull();
  });
});

describe("planLabel", () => {
  it("names a plan", () => {
    expect(planLabel(1)).toBe("en une fois");
    expect(planLabel(10)).toBe("en 10 fois");
  });
});
