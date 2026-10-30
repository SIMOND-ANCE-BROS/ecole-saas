import { describe, expect, it } from "vitest";
import { invoiceProgress, mayDraft, type ProgressInput, REJECTED_ROLES, sendAgainMode } from "./progress";

describe("roles", () => {
  it("lets the front desk and management draft, management alone take up a rejected invoice", () => {
    expect(mayDraft("director")).toBe(true);
    expect(mayDraft("front_desk")).toBe(true);
    expect(mayDraft("teacher")).toBe(false);
    expect(REJECTED_ROLES).toEqual(["director"]);
  });
});

const draft = (o: Partial<ProgressInput> = {}): ProgressInput => ({
  status: "to_send",
  attempts: 0,
  totalInclTaxCents: 36000,
  installmentsCents: [12000, 12000, 12000],
  sendErrorKind: null,
  sendErrorCode: null,
  toolTotalInclTaxCents: null,
  toolRef: null,
  connection: "ready",
  ...o,
});

describe("invoiceProgress", () => {
  it("holds a draft whose installments do not cover its total (#176), whatever its connection", () => {
    for (const installmentsCents of [[], [12000], [12000, 12000, 11999]])
      for (const connection of ["ready", "none", "unavailable"] as const) {
        const p = invoiceProgress(draft({ installmentsCents, connection }));
        expect(p.kind).toBe("held");
        expect(p.label).toBe("En attente des échéances");
        expect(p.detail).toMatch(/échéances/);
      }
  });

  it("says a sendable draft waits when its business has no usable invoicing tool", () => {
    expect(invoiceProgress(draft({ connection: "none" }))).toMatchObject({ kind: "not_connected" });
    expect(invoiceProgress(draft({ connection: "none" })).detail).toMatch(/Paramètres › Entreprises/);
    expect(invoiceProgress(draft({ connection: "unavailable" }))).toMatchObject({ kind: "not_connected" });
  });

  it("shows a sendable draft, or one the tool holds, as on its way", () => {
    expect(invoiceProgress(draft())).toMatchObject({ kind: "sending", label: "Envoi en cours" });
    // Already a draft in the tool: its installments were checked when it was claimed.
    expect(
      invoiceProgress(draft({ status: "tool_draft", installmentsCents: [], toolRef: "t-1", attempts: 1 })),
    ).toMatchObject({ kind: "sending" });
  });

  it("shows a failed attempt that will be tried again by itself", () => {
    const p = invoiceProgress(draft({ attempts: 2, sendErrorKind: "timeout" }));
    expect(p).toMatchObject({ kind: "retrying", label: "Nouvel essai prévu" });
    expect(p.detail).toMatch(/réessaie de lui-même/);
  });

  it("shows an issued invoice, flagging one issued with another total", () => {
    expect(invoiceProgress(draft({ status: "issued", attempts: 1 }))).toMatchObject({ kind: "issued", label: "Émise" });
    const p = invoiceProgress(
      draft({ status: "issued", attempts: 1, sendErrorCode: "total_mismatch", toolTotalInclTaxCents: 35900 }),
    );
    expect(p.kind).toBe("issued_mismatch");
    expect(p.detail).toContain("359,00");
    expect(p.detail).toMatch(/avoir/);
  });

  it("shows a rejected invoice with its reason and who takes it up", () => {
    const p = invoiceProgress(draft({ status: "rejected", attempts: 10, sendErrorKind: "network" }));
    expect(p).toMatchObject({ kind: "rejected", label: "Non émise" });
    expect(p.detail).toMatch(/injoignable/);
    expect(p.detail).toMatch(/direction/);
  });

  it("shows a cancelled invoice as abandoned", () => {
    expect(invoiceProgress(draft({ status: "cancelled", attempts: 1 }))).toMatchObject({
      kind: "cancelled",
      label: "Abandonnée",
    });
  });
});

describe("sendAgainMode", () => {
  it("tries a rejected invoice the tool holds again in the tool", () => {
    expect(sendAgainMode({ status: "rejected", toolRef: "t-1" })).toBe("retry_in_tool");
  });

  it("drafts again the lines of a rejected invoice the tool never held", () => {
    expect(sendAgainMode({ status: "rejected", toolRef: null })).toBe("redraft");
  });

  it("offers nothing on an invoice that is not rejected", () => {
    for (const status of ["to_send", "tool_draft", "issued", "cancelled"] as const)
      expect(sendAgainMode({ status, toolRef: "t-1" })).toBeNull();
  });
});
