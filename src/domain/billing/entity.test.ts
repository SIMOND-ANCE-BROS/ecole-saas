import { describe, expect, it } from "vitest";
import {
  changedFields,
  compact,
  isSiren,
  isSiret,
  isVatNumber,
  looksLikeIban,
  sirenOf,
  siretMatchesSiren,
} from "./entity";

describe("billing entity identifiers", () => {
  it("removes the spaces and dots printed on French papers", () => {
    expect(compact("000 000 001")).toBe("000000001");
    expect(compact("000.000.001")).toBe("000000001");
    expect(compact("000 000 001 00012")).toBe("00000000100012");
  });

  it("checks the SIREN and SIRET lengths", () => {
    expect(isSiren("000000001")).toBe(true);
    expect(isSiren("00000001")).toBe(false);
    expect(isSiren("00000000A")).toBe(false);
    expect(isSiret("00000000100012")).toBe(true);
    expect(isSiret("000000001")).toBe(false);
  });

  it("refuses a SIRET of another SIREN, accepts a missing one", () => {
    expect(siretMatchesSiren("00000000100012", "000000001")).toBe(true);
    expect(siretMatchesSiren("00000000200012", "000000001")).toBe(false);
    expect(siretMatchesSiren(null, "000000001")).toBe(true);
    expect(siretMatchesSiren("00000000100012", null)).toBe(true);
  });

  it("takes the SIREN from the SIRET when only the SIRET was typed", () => {
    expect(sirenOf(null, "00000000100012")).toBe("000000001");
    expect(sirenOf("000000001", null)).toBe("000000001");
    expect(sirenOf(null, null)).toBeNull();
  });

  it("checks an intra-EU VAT number", () => {
    expect(isVatNumber("FR00000000001")).toBe(true);
    expect(isVatNumber("fr00000000001")).toBe(false);
    expect(isVatNumber("00000000001")).toBe(false);
  });

  it("names the fields an edit changed, never their values", () => {
    const before: Record<string, string | null> = { name: "Zz A", siren: "000000001", city: null };
    expect(changedFields(before, { name: "Zz A", siren: "000000002", city: "Zzville" })).toEqual(["siren", "city"]);
    expect(changedFields(before, { ...before })).toEqual([]);
  });

  it("spots an IBAN typed as a bank account label", () => {
    expect(looksLikeIban("FR76 3000 6000 0112 3456 7890 189")).toBe(true);
    expect(looksLikeIban("fr7630006000011234567890189")).toBe(true);
    expect(looksLikeIban("Compte courant Zz Banque")).toBe(false);
    expect(looksLikeIban("Zz Banque n° 12")).toBe(false);
  });
});
