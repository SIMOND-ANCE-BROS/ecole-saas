import { describe, expect, it } from "vitest";
import { isRejection, rejectionDateRefusal, rejectionLabel } from "./rejection";

const DEPOSITED = "2026-10-01";
const TODAY = "2026-10-21";

describe("rejectionDateRefusal", () => {
  it("accepts the deposit day, today and any day between", () => {
    for (const d of [DEPOSITED, "2026-10-15", TODAY]) expect(rejectionDateRefusal(d, DEPOSITED, TODAY)).toBeNull();
  });

  it("refuses a day before the bank deposit", () => {
    expect(rejectionDateRefusal("2026-09-30", DEPOSITED, TODAY)).toBe(
      "Le rejet ne peut pas précéder la remise en banque.",
    );
  });

  it("refuses a day after today", () => {
    expect(rejectionDateRefusal("2026-10-22", DEPOSITED, TODAY)).toBe(
      "Le rejet ne peut pas être daté après aujourd’hui.",
    );
  });

  it("refuses text that is not a date", () => {
    for (const d of ["", "21/10/2026", "2026-13-01", "2026-02-31", "2026-10-21T10:00"])
      expect(rejectionDateRefusal(d, DEPOSITED, TODAY)).toBe("Date invalide.");
  });
});

describe("isRejection", () => {
  it("only a negative payment with the rejection reference", () => {
    expect(isRejection({ amountCents: -5000, reference: "Paiement rejeté" })).toBe(true);
    expect(isRejection({ amountCents: -5000, reference: "Correction" })).toBe(false);
    // A payment typed with that reference by hand is still a payment.
    expect(isRejection({ amountCents: 5000, reference: "Paiement rejeté" })).toBe(false);
  });
});

describe("rejectionLabel", () => {
  it("names a cheque, and any other deposited payment", () => {
    expect(rejectionLabel("cheque")).toBe("Chèque rejeté");
    expect(rejectionLabel("cash")).toBe("Paiement rejeté");
    expect(rejectionLabel("holiday_voucher")).toBe("Paiement rejeté");
  });
});
