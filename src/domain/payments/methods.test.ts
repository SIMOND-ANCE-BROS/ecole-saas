import { describe, expect, it } from "vitest";
import {
  DEFAULT_METHOD_SETTING,
  METHOD_LABELS,
  PAYMENT_METHOD_VALUES,
  effectiveMethodSettings,
  offeredMethods,
  refusedMethod,
  settingsRefusal,
  type MethodSetting,
} from "./methods";
import { isDepositable, toDeposit } from "./deposits";

const setting = (method: MethodSetting["method"], accepted: boolean, deskHint: string | null = null) => ({
  method,
  accepted,
  deskHint,
});

describe("payment methods", () => {
  it("has a French label for every method, ANCV Connect apart from paper vouchers", () => {
    for (const m of PAYMENT_METHOD_VALUES) expect(METHOD_LABELS[m]).toBeTruthy();
    expect(METHOD_LABELS.holiday_voucher_online).toBe("ANCV Connect");
    expect(METHOD_LABELS.holiday_voucher).not.toBe(METHOD_LABELS.holiday_voucher_online);
  });

  it("never offers ANCV Connect for a bank deposit: the operator pays it online", () => {
    expect(isDepositable("holiday_voucher_online")).toBe(false);
    expect(isDepositable("holiday_voucher")).toBe(true);
    const r = toDeposit(
      [
        {
          id: "a",
          method: "holiday_voucher_online",
          amountCents: 5000,
          correctedCents: 0,
          plannedPayment: null,
          depositId: null,
        },
        {
          id: "b",
          method: "holiday_voucher",
          amountCents: 5000,
          correctedCents: 0,
          plannedPayment: null,
          depositId: null,
        },
      ],
      "2026-10-30",
    );
    expect(
      Object.values(r)
        .flat()
        .map((p) => p.id),
    ).toEqual(["b"]);
  });
});

describe("effectiveMethodSettings", () => {
  it("a school that never chose gets the default for every method, card included", () => {
    const r = effectiveMethodSettings([]);
    expect(r.map((s) => s.method)).toEqual([...PAYMENT_METHOD_VALUES]);
    expect(r.every((s) => s.accepted === DEFAULT_METHOD_SETTING.accepted)).toBe(true);
    expect(r.find((s) => s.method === "card")?.accepted).toBe(true);
  });

  it("keeps what the school saved, in the order of the methods", () => {
    const r = effectiveMethodSettings([
      setting("pass_sport", false),
      setting("transfer", true, "Virement : règlement de la totalité"),
      setting("direct_debit", false),
    ]);
    expect(r.map((s) => s.method)).toEqual([...PAYMENT_METHOD_VALUES]);
    expect(r.find((s) => s.method === "transfer")?.deskHint).toBe("Virement : règlement de la totalité");
    expect(r.find((s) => s.method === "pass_sport")?.accepted).toBe(false);
    expect(r.find((s) => s.method === "cheque")?.accepted).toBe(DEFAULT_METHOD_SETTING.accepted);
  });
});

describe("offeredMethods", () => {
  it("offers only the accepted methods, in order", () => {
    const settings = effectiveMethodSettings([
      setting("direct_debit", false),
      setting("pass_sport", false),
      setting("other", false),
      setting("card", false),
    ]);
    expect(offeredMethods(settings)).toEqual([
      "cheque",
      "cash",
      "transfer",
      "holiday_voucher",
      "holiday_voucher_online",
    ]);
  });
});

describe("refusedMethod", () => {
  const settings = effectiveMethodSettings([setting("direct_debit", false), setting("pass_sport", false)]);

  it("accepts a payment by an accepted method", () => {
    expect(refusedMethod(["cheque", "holiday_voucher_online"], settings)).toBeNull();
  });

  it("names the first method the school no longer accepts", () => {
    expect(refusedMethod(["cheque", "pass_sport", "direct_debit"], settings)).toBe("pass_sport");
  });
});

describe("settingsRefusal", () => {
  it("refuses a school accepting no method at all", () => {
    const none = PAYMENT_METHOD_VALUES.map((m) => setting(m, false));
    expect(settingsRefusal(none)).toBe("Cochez au moins un moyen de paiement.");
  });

  it("refuses a method listed twice or missing", () => {
    const all = PAYMENT_METHOD_VALUES.map((m) => setting(m, true));
    expect(settingsRefusal([...all, setting("cash", false)])).not.toBeNull();
    expect(settingsRefusal(all.slice(1))).not.toBeNull();
  });

  it("accepts one accepted method with hints", () => {
    const one = PAYMENT_METHOD_VALUES.map((m) => setting(m, m === "transfer", m === "transfer" ? "Totalité" : null));
    expect(settingsRefusal(one)).toBeNull();
  });
});
