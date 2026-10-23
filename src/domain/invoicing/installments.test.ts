import { describe, expect, it } from "vitest";
import { addMonths, computeSchedule } from "./installments";

describe("calculerEcheancier", () => {
  it("découpe un montant en échéances mensuelles, le reste des centimes sur la première", () => {
    expect(computeSchedule({ amountCents: 10000, installmentCount: 3, firstDate: "2027-09-15" })).toEqual([
      { rank: 1, plannedDate: "2027-09-15", amountCents: 3334 },
      { rank: 2, plannedDate: "2027-10-15", amountCents: 3333 },
      { rank: 3, plannedDate: "2027-11-15", amountCents: 3333 },
    ]);
  });

  it("garde une seule échéance pour un paiement en une fois", () => {
    expect(computeSchedule({ amountCents: 14850, installmentCount: 1, firstDate: "2027-09-05" })).toEqual([
      { rank: 1, plannedDate: "2027-09-05", amountCents: 14850 },
    ]);
  });

  it("retombe toujours sur le montant total, au centime", () => {
    const installments = computeSchedule({ amountCents: 64501, installmentCount: 10, firstDate: "2027-09-01" });
    expect(installments.reduce((s, e) => s + e.amountCents, 0)).toBe(64501);
    expect(installments.at(-1)).toEqual({ rank: 10, plannedDate: "2028-06-01", amountCents: 6450 });
  });

  it("accepte un autre intervalle (trimestriel)", () => {
    const dates = computeSchedule({
      amountCents: 30000,
      installmentCount: 3,
      firstDate: "2027-09-10",
      monthInterval: 3,
    }).map((e) => e.plannedDate);
    expect(dates).toEqual(["2027-09-10", "2027-12-10", "2028-03-10"]);
  });

  it("refuse des paramètres invalides", () => {
    const base = { amountCents: 10000, installmentCount: 3, firstDate: "2027-09-15" };
    expect(() => computeSchedule({ ...base, amountCents: 0 })).toThrow(TypeError);
    expect(() => computeSchedule({ ...base, amountCents: 99.5 })).toThrow(TypeError);
    expect(() => computeSchedule({ ...base, installmentCount: 0 })).toThrow(TypeError);
    expect(() => computeSchedule({ ...base, monthInterval: 0 })).toThrow(TypeError);
    expect(() => computeSchedule({ ...base, firstDate: "15/09/2027" })).toThrow(TypeError);
    expect(() => computeSchedule({ ...base, firstDate: "2027-02-30" })).toThrow(TypeError);
  });
});

describe("ajouterMois", () => {
  it("garde le jour quand il existe", () => {
    expect(addMonths("2027-09-15", 1)).toBe("2027-10-15");
  });

  it("ramène au dernier jour du mois quand le jour n’existe pas", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2027-08-31", 1)).toBe("2027-09-30");
  });

  it("calcule chaque date depuis la première, sans dérive après un mois court", () => {
    // 31 janvier + 2 mois = 31 mars, pas 28 mars.
    expect(addMonths("2027-01-31", 2)).toBe("2027-03-31");
  });

  it("passe d’une année à l’autre", () => {
    expect(addMonths("2027-11-30", 3)).toBe("2028-02-29");
  });
});
