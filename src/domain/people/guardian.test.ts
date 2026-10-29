import { describe, expect, it } from "vitest";
import {
  canBeLegalGuardian,
  GUARDIAN_BECOMES_ORGANISATION_REFUSAL,
  guardianRefusal,
  ORGANISATION_GUARDIAN_REFUSAL,
  ORGANISATION_WARD_REFUSAL,
  typeChangeRefusal,
  WARD_BECOMES_ORGANISATION_REFUSAL,
} from "./guardian";

describe("canBeLegalGuardian", () => {
  it("accepts an individual", () => {
    expect(canBeLegalGuardian("individual")).toBe(true);
  });

  it("refuses an organisation", () => {
    expect(canBeLegalGuardian("organisation")).toBe(false);
  });
});

describe("guardianRefusal", () => {
  it("refuses an organisation as legal guardian, with a French message", () => {
    expect(guardianRefusal("legal_guardian", "organisation", "individual")).toBe(ORGANISATION_GUARDIAN_REFUSAL);
    expect(ORGANISATION_GUARDIAN_REFUSAL).toMatch(/« Facturé à »/);
  });

  it("refuses a legal guardian for an organisation", () => {
    expect(guardianRefusal("legal_guardian", "individual", "organisation")).toBe(ORGANISATION_WARD_REFUSAL);
  });

  it("accepts an individual as legal guardian of an individual", () => {
    expect(guardianRefusal("legal_guardian", "individual", "individual")).toBeNull();
  });

  it("keeps organisations for the other relationship kinds", () => {
    expect(guardianRefusal("other", "organisation", "individual")).toBeNull();
    expect(guardianRefusal("partner", "individual", "organisation")).toBeNull();
  });
});

describe("typeChangeRefusal", () => {
  const none = { isGuardian: false, hasGuardian: false };

  it("refuses turning a legal guardian into an organisation", () => {
    expect(typeChangeRefusal("organisation", { isGuardian: true, hasGuardian: false })).toBe(
      GUARDIAN_BECOMES_ORGANISATION_REFUSAL,
    );
  });

  it("refuses turning a person who has a legal guardian into an organisation", () => {
    expect(typeChangeRefusal("organisation", { isGuardian: false, hasGuardian: true })).toBe(
      WARD_BECOMES_ORGANISATION_REFUSAL,
    );
  });

  it("accepts any other change", () => {
    expect(typeChangeRefusal("organisation", none)).toBeNull();
    expect(typeChangeRefusal("individual", { isGuardian: true, hasGuardian: true })).toBeNull();
  });
});
