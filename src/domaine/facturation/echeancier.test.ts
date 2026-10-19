import { describe, expect, it } from "vitest";
import { ajouterMois, calculerEcheancier } from "./echeancier";

describe("calculerEcheancier", () => {
  it("découpe un montant en échéances mensuelles, le reste des centimes sur la première", () => {
    expect(calculerEcheancier({ montantCentimes: 10000, nbEcheances: 3, premiereDate: "2027-09-15" })).toEqual([
      { rang: 1, datePrevue: "2027-09-15", montantCentimes: 3334 },
      { rang: 2, datePrevue: "2027-10-15", montantCentimes: 3333 },
      { rang: 3, datePrevue: "2027-11-15", montantCentimes: 3333 },
    ]);
  });

  it("garde une seule échéance pour un paiement en une fois", () => {
    expect(calculerEcheancier({ montantCentimes: 14850, nbEcheances: 1, premiereDate: "2027-09-05" })).toEqual([
      { rang: 1, datePrevue: "2027-09-05", montantCentimes: 14850 },
    ]);
  });

  it("retombe toujours sur le montant total, au centime", () => {
    const echeances = calculerEcheancier({ montantCentimes: 64501, nbEcheances: 10, premiereDate: "2027-09-01" });
    expect(echeances.reduce((s, e) => s + e.montantCentimes, 0)).toBe(64501);
    expect(echeances.at(-1)).toEqual({ rang: 10, datePrevue: "2028-06-01", montantCentimes: 6450 });
  });

  it("accepte un autre intervalle (trimestriel)", () => {
    const dates = calculerEcheancier({
      montantCentimes: 30000,
      nbEcheances: 3,
      premiereDate: "2027-09-10",
      intervalleMois: 3,
    }).map((e) => e.datePrevue);
    expect(dates).toEqual(["2027-09-10", "2027-12-10", "2028-03-10"]);
  });

  it("refuse des paramètres invalides", () => {
    const base = { montantCentimes: 10000, nbEcheances: 3, premiereDate: "2027-09-15" };
    expect(() => calculerEcheancier({ ...base, montantCentimes: 0 })).toThrow(TypeError);
    expect(() => calculerEcheancier({ ...base, montantCentimes: 99.5 })).toThrow(TypeError);
    expect(() => calculerEcheancier({ ...base, nbEcheances: 0 })).toThrow(TypeError);
    expect(() => calculerEcheancier({ ...base, intervalleMois: 0 })).toThrow(TypeError);
    expect(() => calculerEcheancier({ ...base, premiereDate: "15/09/2027" })).toThrow(TypeError);
    expect(() => calculerEcheancier({ ...base, premiereDate: "2027-02-30" })).toThrow(TypeError);
  });
});

describe("ajouterMois", () => {
  it("garde le jour quand il existe", () => {
    expect(ajouterMois("2027-09-15", 1)).toBe("2027-10-15");
  });

  it("ramène au dernier jour du mois quand le jour n’existe pas", () => {
    expect(ajouterMois("2027-01-31", 1)).toBe("2027-02-28");
    expect(ajouterMois("2028-01-31", 1)).toBe("2028-02-29");
    expect(ajouterMois("2027-08-31", 1)).toBe("2027-09-30");
  });

  it("calcule chaque date depuis la première, sans dérive après un mois court", () => {
    // 31 janvier + 2 mois = 31 mars, pas 28 mars.
    expect(ajouterMois("2027-01-31", 2)).toBe("2027-03-31");
  });

  it("passe d’une année à l’autre", () => {
    expect(ajouterMois("2027-11-30", 3)).toBe("2028-02-29");
  });
});
