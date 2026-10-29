import { describe, expect, it } from "vitest";
import { PAYMENT_COLUMNS } from "../filters/columns";
import { EMPTY_FILTER, readFilter } from "../filters/filters";
import { totals } from "./deposits";
import {
  exportReference,
  futureCashing,
  paymentLogQuery,
  paymentLogValue,
  referenceOf,
  shownPaymentLog,
  type PaymentLogRow,
} from "./payment-log";

const TODAY = "2026-10-15";
const LABELS = {
  cheque: "Chèque",
  cash: "Espèces",
  card: "Carte",
  holiday_voucher: "Chèques vacances",
  pass_sport: "Pass’Sport",
} as const;
type Row = PaymentLogRow & { method: keyof typeof LABELS };
const row = (r: Partial<Row> & Pick<Row, "method">): Row => ({
  date: "2026-10-01",
  payer: "Zz Payeur",
  methodLabel: LABELS[r.method],
  amountCents: 10000,
  reversalKind: null,
  reference: null,
  issuer: null,
  plannedPayment: null,
  dateDeposit: null,
  ...r,
});

const ROWS: Row[] = [
  row({ payer: "Zz Martin", method: "cheque", amountCents: 12000, plannedPayment: "2026-11-05", reference: "0012345" }),
  row({ payer: "Zz Bernard", method: "cash", amountCents: 3500, date: "2026-10-03" }),
  // A correction cancelling Zz Bernard's cash payment.
  row({ payer: "Zz Bernard", method: "cash", amountCents: -3500, date: "2026-10-04", reversalKind: "correction" }),
  row({ payer: "Zz Arnaud", method: "cheque", amountCents: 9000, date: "2026-10-02", dateDeposit: "2026-10-10" }),
  row({ payer: "Zz Colin", method: "holiday_voucher", amountCents: 5000 }),
  row({ payer: "Zz Durand", method: "pass_sport", amountCents: 5000 }),
  row({ payer: "Zz Petit", method: "card", amountCents: 1 }),
];
const filter = (...f: string[]) => readFilter(f, null, PAYMENT_COLUMNS);
const shown = (...f: string[]) => shownPaymentLog(ROWS, filter(...f), null, TODAY);

describe("payment log values", () => {
  it("shows a cheque's cashing date only while it is to come", () => {
    expect(futureCashing({ plannedPayment: "2026-11-05" }, TODAY)).toBe("2026-11-05");
    expect(futureCashing({ plannedPayment: "2026-10-15" }, TODAY)).toBeNull();
    expect(futureCashing({ plannedPayment: null }, TODAY)).toBeNull();
  });

  it("joins the cheque number and its bank", () => {
    expect(referenceOf({ reversalKind: null, reference: "0012345", issuer: "Zz Banque" })).toBe("0012345, Zz Banque");
    expect(referenceOf({ reversalKind: null, reference: null, issuer: null })).toBeNull();
  });

  it("names a reverse entry from its stored kind, before the original cheque number (#272)", () => {
    const rejected = { reversalKind: "rejection", reference: "0012345", issuer: "Zz Banque" } as const;
    expect(referenceOf(rejected)).toBe("Paiement rejeté, 0012345, Zz Banque");
    expect(exportReference(rejected)).toBe("Paiement rejeté, 0012345");
    expect(exportReference({ reversalKind: "correction", reference: null })).toBe("Correction");
    // A payment whose reference was typed as the label is still an ordinary payment.
    expect(exportReference({ reversalKind: null, reference: "Paiement rejeté" })).toBe("Paiement rejeté");
    expect(exportReference({ reversalKind: null, reference: null })).toBeNull();
  });

  it("sorts the amount in cents", () => expect(paymentLogValue(ROWS[0], "montant", TODAY)).toBe(12000));
});

describe("shownPaymentLog", () => {
  it("keeps the period's order without filter nor sort", () =>
    expect(shownPaymentLog(ROWS, EMPTY_FILTER, null, TODAY)).toEqual(ROWS));

  it("filters the method by checkboxes", () =>
    expect(shown("moyen.parmi.Chèque").map((r) => r.payer)).toEqual(["Zz Martin", "Zz Arnaud"]));

  it("filters holiday vouchers and Pass’Sport (typographic apostrophe) together", () =>
    expect(shown("moyen.parmi.Chèques vacances|Pass’Sport").map((r) => r.payer)).toEqual(["Zz Colin", "Zz Durand"]));

  it("filters payments not yet deposited (empty « Remise »)", () => expect(shown("remise.vide")).toHaveLength(6));

  it("sorts by amount, the correction first in ascending order", () =>
    expect(
      shownPaymentLog(ROWS, EMPTY_FILTER, { column: "montant", direction: "asc" }, TODAY).map((r) => r.amountCents),
    ).toEqual([-3500, 1, 3500, 5000, 5000, 9000, 12000]));

  it("ignores filters on columns that are not filterable (amount, date received)", () => {
    expect(shown("montant.sup_egal.100")).toHaveLength(ROWS.length);
    expect(shown("recu.sup_egal.2026-10-03")).toHaveLength(ROWS.length);
  });
});

describe("totals of the rows shown", () => {
  it("nets a correction shown with its original", () => {
    const t = totals(shown("moyen.parmi.Espèces"));
    expect(t.total).toBe(0);
    expect(t.byMethod).toEqual({ cash: 0 });
  });

  it("counts only the side a filter keeps when it splits a payment from its correction", () => {
    expect(totals(shown("reference.contient.Correction")).total).toBe(-3500);
    expect(totals(shown("payeur.contient.Bernard", "reference.vide")).total).toBe(3500);
  });

  it("keeps a 1-cent payment exact", () =>
    expect(totals(shown("moyen.parmi.Carte"))).toEqual({ total: 1, byMethod: { card: 1 } }));

  it("is zero for an empty result", () =>
    expect(totals(shown("payeur.contient.Personne"))).toEqual({ total: 0, byMethod: {} }));

  it("adds every method up", () => expect(totals(shownPaymentLog(ROWS, EMPTY_FILTER, null, TODAY)).total).toBe(31001));
});

describe("paymentLogQuery: the page and the export read the same query", () => {
  const query = (q: string) => paymentLogQuery(new URLSearchParams(q), LABELS);

  it("reads the filters and the sort", () => {
    const { filter: f, sort, legacy } = query("f=moyen.parmi.Chèque&sort=montant&order=desc");
    expect(f.conditions).toEqual([{ column: "moyen", operator: "parmi", value: "Chèque" }]);
    expect(sort).toEqual({ column: "montant", direction: "desc" });
    expect(legacy).toBe(false);
  });

  it("turns an older `?moyen=` into the method checkbox", () => {
    const q = query("du=2026-10-01&moyen=holiday_voucher");
    expect(q.legacy).toBe(true);
    expect(shownPaymentLog(ROWS, q.filter, q.sort, TODAY).map((r) => r.payer)).toEqual(["Zz Colin"]);
  });

  it("does not add a second method condition, and drops an unknown `?moyen=`", () => {
    expect(query("moyen=cash&f=moyen.parmi.Chèque").filter.conditions).toHaveLength(1);
    const unknown = query("moyen=bitcoin");
    expect(unknown).toMatchObject({ legacy: true, filter: { conditions: [] } });
  });

  it("gives the export the same rows as the page, in the same order", () => {
    const params = "f=moyen.parmi.Chèque|Espèces&sort=montant&order=desc&page=2";
    const page = query(params);
    const exported = query(params);
    expect(shownPaymentLog(ROWS, exported.filter, exported.sort, TODAY)).toEqual(
      shownPaymentLog(ROWS, page.filter, page.sort, TODAY),
    );
  });
});
