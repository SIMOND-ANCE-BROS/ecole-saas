import { describe, expect, it } from "vitest";
import {
  afterFailure,
  billsItsLines,
  isSendable,
  MAX_ATTEMPTS,
  retryDelayMinutes,
  sendFailureReason,
  type SendFailureKind,
} from "./outbox";

describe("retryDelayMinutes", () => {
  it("waits 1 min, 5 min, 30 min, 2 h, 6 h, then every 12 h", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 9].map(retryDelayMinutes)).toEqual([1, 5, 30, 120, 360, 720, 720, 720]);
  });

  it("refuses an attempt count that is not a positive integer", () => {
    expect(() => retryDelayMinutes(0)).toThrow(RangeError);
    expect(() => retryDelayMinutes(1.5)).toThrow(RangeError);
  });
});

describe("afterFailure", () => {
  it.each<SendFailureKind>(["timeout", "network", "server", "credentials", "internal"])(
    "tries a %s failure again after the backoff",
    (kind) => {
      expect(afterFailure({ kind, code: null }, 1)).toEqual({ status: "retry", delayMinutes: 1 });
      expect(afterFailure({ kind, code: null }, 4)).toEqual({ status: "retry", delayMinutes: 120 });
    },
  );

  it("rejects at the 10th failed attempt, never an 11th", () => {
    expect(afterFailure({ kind: "server", code: "status_503" }, MAX_ATTEMPTS - 1)).toEqual({
      status: "retry",
      delayMinutes: 720,
    });
    expect(afterFailure({ kind: "server", code: "status_503" }, MAX_ATTEMPTS)).toEqual({ status: "rejected" });
    expect(afterFailure({ kind: "timeout", code: null }, MAX_ATTEMPTS + 1)).toEqual({ status: "rejected" });
  });

  it.each<SendFailureKind>(["rejected", "format", "not_found", "unsupported", "configuration", "number_tool_mismatch"])(
    "rejects a %s failure at once: sending it again would fail again",
    (kind) => {
      expect(afterFailure({ kind, code: null }, 1)).toEqual({ status: "rejected" });
    },
  );
});

describe("isSendable (#176 Q1: nothing issued without due dates)", () => {
  it("sends a draft whose installments add up to its total", () => {
    expect(isSendable({ totalInclTaxCents: 36000, installmentsCents: [12000, 12000, 12000] })).toBe(true);
  });

  it("holds a draft without installments, such as a yearly package", () => {
    expect(isSendable({ totalInclTaxCents: 56000, installmentsCents: [] })).toBe(false);
  });

  it("holds a draft whose installments add up to more than its total", () => {
    expect(isSendable({ totalInclTaxCents: 12000, installmentsCents: [6000, 6001] })).toBe(false);
  });

  it("holds a draft whose installments cover only part of it (quarterly + yearly)", () => {
    expect(isSendable({ totalInclTaxCents: 76000, installmentsCents: [12000, 12000] })).toBe(false);
  });
});

describe("billsItsLines", () => {
  it("keeps the lines of drafts, invoices in the tool and issued invoices", () => {
    for (const status of ["to_send", "tool_draft", "issued"])
      expect(billsItsLines({ status, toolRef: status === "to_send" ? null : "t1" })).toBe(true);
  });

  it("gives them back when the tool cancelled its draft", () => {
    expect(billsItsLines({ status: "cancelled", toolRef: "t1" })).toBe(false);
  });

  it("gives them back when rejected before the tool held any document of it", () => {
    expect(billsItsLines({ status: "rejected", toolRef: null })).toBe(false);
  });

  it("keeps them when rejected while the tool holds a draft it may have issued unseen", () => {
    expect(billsItsLines({ status: "rejected", toolRef: "t1" })).toBe(true);
  });
});

describe("sendFailureReason", () => {
  it("explains a known code first, in French", () => {
    expect(sendFailureReason("rejected", "total_mismatch")).toMatch(/total TTC différent/);
  });

  it("falls back on the kind for an unknown or missing code", () => {
    expect(sendFailureReason("rejected", "status_422")).toBe("L’outil de facturation a refusé la facture.");
    expect(sendFailureReason("server", null)).toMatch(/en panne/);
  });

  it("never echoes what it does not know", () => {
    expect(sendFailureReason("toString", "constructor")).toBe("L’envoi à l’outil de facturation a échoué.");
    expect(sendFailureReason(null, null)).toBe("L’envoi à l’outil de facturation a échoué.");
  });
});
