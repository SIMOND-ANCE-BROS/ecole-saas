import { describe, expect, it } from "vitest";
import { payerBalance } from "./balance";

const TODAY = "2026-10-21";

describe("soldePayeur", () => {
  it("dû = inscriptions actives et terminées + carnets ; reste = dû − payé", () => {
    const s = payerBalance(
      [
        { status: "active", netPriceCents: 32_000 },
        { status: "ended", netPriceCents: 10_050 },
      ],
      [{ priceCents: 12_000 }],
      [{ amountCents: 20_000, plannedPayment: null }],
      TODAY,
    );
    expect(s).toEqual({ du: 54_050, paye: 20_000, remaining: 34_050, toCollect: 0, outsideCalculation: {} });
  });

  it("trois chèques datés : tous comptés payés, ceux à venir signalés à encaisser", () => {
    const s = payerBalance(
      [{ status: "active", netPriceCents: 30_000 }],
      [],
      [
        { amountCents: 10_000, plannedPayment: null },
        { amountCents: 10_000, plannedPayment: "2027-01-05" },
        { amountCents: 10_000, plannedPayment: "2027-04-05" },
      ],
      TODAY,
    );
    expect(s).toMatchObject({ paye: 30_000, remaining: 0, toCollect: 20_000 });
  });

  it("une correction (paiement négatif) réduit le payé ; un chèque arrivé à échéance n'est plus « à encaisser »", () => {
    const s = payerBalance(
      [{ status: "active", netPriceCents: 15_000 }],
      [],
      [
        { amountCents: 15_000, plannedPayment: "2026-10-21" },
        { amountCents: 5_000, plannedPayment: null },
        { amountCents: -5_000, plannedPayment: null },
      ],
      TODAY,
    );
    expect(s).toMatchObject({ paye: 15_000, remaining: 0, toCollect: 0 });
  });

  it("abandon, essai et liste d'attente restent hors du calcul, mais visibles (#99)", () => {
    const s = payerBalance(
      [
        { status: "dropped", netPriceCents: 20_000 },
        { status: "trial", netPriceCents: 1_500 },
        { status: "waitlist", netPriceCents: 9_000 },
      ],
      [],
      [{ amountCents: 1_000, plannedPayment: null }],
      TODAY,
    );
    expect(s).toEqual({
      du: 0,
      paye: 1_000,
      remaining: -1_000,
      toCollect: 0,
      outsideCalculation: { dropped: 20_000, trial: 1_500, waitlist: 9_000 },
    });
  });
});
