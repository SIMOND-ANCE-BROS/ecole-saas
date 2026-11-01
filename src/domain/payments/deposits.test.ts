import { describe, expect, it } from "vitest";
import type { ReversalKind } from "./rejection";
import { depositGroups, toDeposit, totals, totalsByEntity, toCsv } from "./deposits";

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

describe("toDeposit", () => {
  it("cheques past their date, cash and holiday vouchers, not yet deposited", () => {
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

  it("neither corrections nor a fully corrected cheque; a partly corrected cheque is still to deposit", () => {
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

describe("depositGroups", () => {
  const of = (entity: string, x: ReturnType<typeof p>) => ({ ...x, billingEntityId: entity });
  const ids = (groups: ReturnType<typeof depositGroups>) =>
    groups.map((g) => `${g.billingEntityId}/${g.method}:${g.payments.map((x) => x.id).join(",")}`);

  it("one slip per entity and method: each business deposits into its own account (#300)", () => {
    const groups = depositGroups(
      [
        of("b", p("1", "cheque", 1000)),
        of("a", p("2", "cash", 2000)),
        of("a", p("3", "cheque", 3000)),
        of("b", p("4", "cheque", 4000)),
        of("a", p("5", "card", 5000)),
      ],
      "2026-10-21",
      ["a", "b"],
    );
    expect(ids(groups)).toEqual(["a/cheque:3", "a/cash:2", "b/cheque:1,4"]);
  });

  it("entities in the order given (the default first), an unknown one after them; empty groups left out", () => {
    const groups = depositGroups(
      [
        of("z", p("1", "holiday_voucher", 1000)),
        of("b", p("2", "cheque", 1000, { plannedPayment: "2027-01-05" })),
        of("b", p("3", "cash", 1000)),
      ],
      "2026-10-21",
      ["a", "b"],
    );
    expect(ids(groups)).toEqual(["b/cash:3", "z/holiday_voucher:1"]);
  });

  it("nothing to deposit: no group", () => {
    expect(depositGroups([], "2026-10-21", ["a"])).toEqual([]);
  });
});

it("totals per payment method, corrections included", () => {
  expect(totals([p("a", "cheque", 10000), p("b", "cheque", -4000), p("c", "cash", 2050)])).toEqual({
    total: 8050,
    byMethod: { cheque: 6000, cash: 2050 },
    refunded: 0,
  });
});

it("totals refunds apart, out of their method's total (#294)", () => {
  expect(
    totals([
      p("a", "cheque", 28000),
      { ...p("b", "cheque", 10000), reversalKind: null },
      { ...p("c", "cheque", -4000), reversalKind: "correction" as const },
      { ...p("d", "cheque", -6000), reversalKind: "refund" as const },
      { ...p("e", "transfer", -1500), reversalKind: "refund" as const },
    ]),
  ).toEqual({ total: 26500, byMethod: { cheque: 34000 }, refunded: -7500 });
});

describe("totalsByEntity (#329)", () => {
  const at = (entity: string, row: ReturnType<typeof p> & { reversalKind?: ReversalKind | null }) => ({
    ...row,
    billingEntityId: entity,
  });

  it("totals each business per method, corrections, rejections and refunds included", () => {
    const rows = [
      at("b", p("b1", "cheque", 20000)),
      at("a", p("a1", "cheque", 10000)),
      at("a", { ...p("a2", "cheque", -10000), reversalKind: "rejection" }),
      at("a", p("a3", "cash", 2050)),
      at("b", { ...p("b2", "cheque", -5000), reversalKind: "correction" }),
      at("b", { ...p("b3", "transfer", -3000), reversalKind: "refund" }),
      at("b", { ...p("b4", "transfer", 1000), reversalKind: "refund_cancellation" }),
    ];
    expect(totalsByEntity(rows, ["a", "b"])).toEqual([
      { billingEntityId: "a", totals: { total: 2050, byMethod: { cheque: 0, cash: 2050 }, refunded: 0 } },
      { billingEntityId: "b", totals: { total: 13000, byMethod: { cheque: 15000 }, refunded: -2000 } },
    ]);
  });

  it("adds up to the overall total, to the cent, reverse entries included", () => {
    const rows = [
      at("a", p("a1", "card", 1)),
      at("b", p("b1", "card", 2)),
      at("b", p("b2", "cheque", 7001)),
      at("b", { ...p("b3", "cheque", -7001), reversalKind: "rejection" }),
      at("c", { ...p("c1", "cash", -333), reversalKind: "refund" }),
      at("c", { ...p("c2", "cash", 111), reversalKind: "refund_cancellation" }),
      at("a", p("a2", "cash", 9999)),
      at("a", { ...p("a3", "cash", -99), reversalKind: "correction" }),
    ];
    const all = totals(rows);
    const parts = totalsByEntity(rows, ["a", "b", "c"]).map((e) => e.totals);
    const sum = (f: (t: (typeof parts)[number]) => number) => parts.reduce((s, t) => s + f(t), 0);
    expect(sum((t) => t.total)).toBe(all.total);
    expect(sum((t) => t.refunded)).toBe(all.refunded);
    for (const [method, cents] of Object.entries(all.byMethod))
      expect(
        sum((t) => t.byMethod[method] ?? 0),
        method,
      ).toBe(cents);
    expect(Object.keys(all.byMethod).sort()).toEqual(["card", "cash", "cheque"]);
  });

  it("follows the given order, then any other business in the order its rows come", () => {
    const rows = [at("z", p("z1", "cash", 100)), at("y", p("y1", "cash", 100)), at("b", p("b1", "cash", 100))];
    expect(totalsByEntity(rows, ["a", "b"]).map((e) => e.billingEntityId)).toEqual(["b", "z", "y"]);
  });

  it("leaves out a business with no row shown, and is empty without rows", () => {
    expect(totalsByEntity([at("b", p("b1", "cash", 100))], ["a", "b"]).map((e) => e.billingEntityId)).toEqual(["b"]);
    expect(totalsByEntity([], ["a", "b"])).toEqual([]);
  });

  it("keeps a business whose rows net to zero: a payment and its correction were shown", () => {
    const rows = [at("a", p("a1", "cash", 500)), at("a", { ...p("a2", "cash", -500), reversalKind: "correction" })];
    expect(totalsByEntity(rows, ["a"])).toEqual([
      { billingEntityId: "a", totals: { total: 0, byMethod: { cash: 0 }, refunded: 0 } },
    ]);
  });
});

describe("toCsv", () => {
  it("« ; » separator, comma amounts, French dates, BOM", () => {
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
        entity: "Zz Danse",
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
        entity: "Zz Studio",
      },
    ]);
    expect(csv.startsWith("﻿Date;Payeur;Moyen;Montant")).toBe(true);
    const rows = csv.slice(1).split("\r\n");
    expect(rows[1]).toBe("21/10/2026;Martin, Sophie;Chèque;100,50;1234567;Crédit Mutuel;05/01/2027;;Zz Danse");
    expect(rows[2]).toBe('21/10/2026;"Petit; Anne";Chèque;-40,00;Correction;;;22/10/2026;Zz Studio');
  });

  it("« Entreprise » is always the last column, even for a school with a single one (#300)", () => {
    const header = toCsv([]).slice(1).split("\r\n")[0].split(";");
    expect(header.at(-1)).toBe("Entreprise");
    expect(header).toEqual([
      "Date",
      "Payeur",
      "Moyen",
      "Montant",
      "Référence",
      "Émetteur",
      "Encaissement prévu",
      "Remise",
      "Entreprise",
    ]);
  });

  it("a text cell is never read as a formula", () => {
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
        entity: "=Zz",
      },
    ]);
    expect(csv.split("\r\n")[1]).toBe(`21/10/2026;"'=HYPERLINK(""x"")";Chèque;1,00;'+33;'@x;;;'=Zz`);
  });
});
