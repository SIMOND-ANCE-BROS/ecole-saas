import { describe, expect, it } from "vitest";
import { toDeposit, totals, toCsv } from "./deposits";

const p = (
  id: string,
  method: string,
  amountCents: number,
  extra: Partial<{ correctedCents: number; plannedPayment: string | null; depositId: string | null }> = {},
) => ({
  id,
  method: method,
  amountCents: amountCents,
  correctedCents: 0,
  plannedPayment: null,
  depositId: null,
  ...extra,
});

describe("aRemettre", () => {
  it("chèques arrivés à échéance, espèces et chèques vacances, pas encore remis", () => {
    const r = toDeposit(
      [
        p("a", "cheque", 10000),
        p("b", "cheque", 10000, { plannedPayment: "2026-10-21" }),
        p("c", "cheque", 10000, { plannedPayment: "2027-01-05" }),
        p("d", "cash", 2000),
        p("e", "holiday_voucher", 5000),
        p("f", "card", 8000),
        p("g", "cheque", 10000, { depositId: "r1" }),
      ],
      "2026-10-21",
    );
    expect(r.cheque.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r.cash.map((x) => x.id)).toEqual(["d"]);
    expect(r.holiday_voucher.map((x) => x.id)).toEqual(["e"]);
  });

  it("ni les corrections, ni un chèque entièrement corrigé ; un chèque corrigé en partie reste à remettre", () => {
    const r = toDeposit(
      [
        p("a", "cheque", -10000),
        p("b", "cheque", 10000, { correctedCents: 10000 }),
        p("c", "cheque", 10000, { correctedCents: 4000 }),
      ],
      "2026-10-21",
    );
    expect(r.cheque.map((x) => x.id)).toEqual(["c"]);
  });
});

it("totaux par moyen, corrections comprises", () => {
  expect(totals([p("a", "cheque", 10000), p("b", "cheque", -4000), p("c", "cash", 2050)])).toEqual({
    total: 8050,
    byMethod: { cheque: 6000, cash: 2050 },
  });
});

describe("versCsv", () => {
  it("séparateur « ; », montants à virgule, dates françaises, BOM", () => {
    const csv = toCsv([
      {
        date: "2026-10-21",
        payer: "Martin, Sophie",
        method: "Chèque",
        amountCents: 10050,
        reference: "1234567",
        issuer: "Crédit Mutuel",
        plannedPayment: "2027-01-05",
        deposit: null,
      },
      {
        date: "2026-10-21",
        payer: "Petit; Anne",
        method: "Chèque",
        amountCents: -4000,
        reference: "Correction",
        issuer: null,
        plannedPayment: null,
        deposit: "2026-10-22",
      },
    ]);
    expect(csv.startsWith("﻿Date;Payeur;Moyen;Montant")).toBe(true);
    const rows = csv.slice(1).split("\r\n");
    expect(rows[1]).toBe("21/10/2026;Martin, Sophie;Chèque;100,50;1234567;Crédit Mutuel;05/01/2027;");
    expect(rows[2]).toBe('21/10/2026;"Petit; Anne";Chèque;-40,00;Correction;;;22/10/2026');
  });

  it("une cellule texte n'est jamais lue comme une formule", () => {
    const csv = toCsv([
      {
        date: "2026-10-21",
        payer: '=HYPERLINK("x")',
        method: "Chèque",
        amountCents: 100,
        reference: "+33",
        issuer: "@x",
        plannedPayment: null,
        deposit: null,
      },
    ]);
    expect(csv.split("\r\n")[1]).toBe(`21/10/2026;"'=HYPERLINK(""x"")";Chèque;1,00;'+33;'@x;;`);
  });
});
