import { describe, expect, it } from "vitest";
import { canBeLegalGuardian, guardianRefusal, ORGANISATION_GUARDIAN_REFUSAL } from "./guardian";

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
    expect(guardianRefusal("legal_guardian", "organisation")).toBe(ORGANISATION_GUARDIAN_REFUSAL);
    expect(ORGANISATION_GUARDIAN_REFUSAL).toMatch(/« Facturé à »/);
  });

  it("accepts an individual as legal guardian", () => {
    expect(guardianRefusal("legal_guardian", "individual")).toBeNull();
  });

  it("keeps organisations for the other relationship kinds", () => {
    expect(guardianRefusal("other", "organisation")).toBeNull();
    expect(guardianRefusal("partner", "organisation")).toBeNull();
  });
});
