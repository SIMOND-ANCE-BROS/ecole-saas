import { describe, expect, it } from "vitest";
import { isRejection, rejectionDateRefusal, rejectionLabel, rejectionNotYet, reversalLabel } from "./rejection";

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

  it("refuses any day while the deposit is dated after today", () => {
    const notYet = "La remise est datée du 25/10/2026 : un rejet ne peut être enregistré qu’à partir de cette date.";
    expect(rejectionNotYet("2026-10-25", TODAY)).toBe(notYet);
    expect(rejectionDateRefusal(TODAY, "2026-10-25", TODAY)).toBe(notYet);
    expect(rejectionNotYet(TODAY, TODAY)).toBeNull();
  });

  it("refuses text that is not a date", () => {
    for (const d of ["", "21/10/2026", "2026-13-01", "2026-02-31", "2026-10-21T10:00"])
      expect(rejectionDateRefusal(d, DEPOSITED, TODAY)).toBe("Date invalide.");
  });
});

describe("isRejection", () => {
  it("reads the stored kind, never the reference", () => {
    expect(isRejection({ reversalKind: "rejection" })).toBe(true);
    expect(isRejection({ reversalKind: "correction" })).toBe(false);
    // An ordinary payment, whatever its reference.
    expect(isRejection({ reversalKind: null })).toBe(false);
  });
});

describe("reversalLabel", () => {
  it("names each kind of reverse entry, and nothing for an ordinary payment", () => {
    expect(reversalLabel("rejection")).toBe("Paiement rejeté");
    expect(reversalLabel("correction")).toBe("Correction");
    expect(reversalLabel(null)).toBeNull();
  });
});

describe("rejectionLabel", () => {
  it("names a cheque, and any other deposited payment", () => {
    expect(rejectionLabel("cheque")).toBe("Chèque rejeté");
    expect(rejectionLabel("cash")).toBe("Paiement rejeté");
    expect(rejectionLabel("holiday_voucher")).toBe("Paiement rejeté");
  });
});
