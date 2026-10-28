import { describe, expect, it } from "vitest";
import { PAYMENT_COLUMNS } from "../filters/columns";
import { EMPTY_FILTER, readFilter } from "../filters/filters";
import { futureCashing, journalValue, referenceOf, shownJournal, type JournalRow } from "./journal";

const TODAY = "2026-10-15";
const row = (r: Partial<JournalRow>): JournalRow => ({
  date: "2026-10-01",
  payer: "Zz Payeur",
  methodLabel: "Chèque",
  amountCents: 10000,
  reference: null,
  issuer: null,
  plannedPayment: null,
  dateDeposit: null,
  ...r,
});

const ROWS = [
  row({ payer: "Zz Martin", methodLabel: "Chèque", amountCents: 12000, plannedPayment: "2026-11-05" }),
  row({ payer: "Zz Bernard", methodLabel: "Espèces", amountCents: 3500, date: "2026-10-03" }),
  row({ payer: "Zz Durand", methodLabel: "Carte", amountCents: -2000, date: "2026-10-04", dateDeposit: null }),
  row({ payer: "Zz Arnaud", methodLabel: "Chèque", amountCents: 9000, date: "2026-10-02", dateDeposit: "2026-10-10" }),
];
const filter = (...f: string[]) => readFilter(f, null, PAYMENT_COLUMNS);

describe("journal values", () => {
  it("shows a cheque's cashing date only while it is to come", () => {
    expect(futureCashing({ plannedPayment: "2026-11-05" }, TODAY)).toBe("2026-11-05");
    expect(futureCashing({ plannedPayment: "2026-10-15" }, TODAY)).toBeNull();
    expect(futureCashing({ plannedPayment: null }, TODAY)).toBeNull();
  });

  it("joins the cheque number and its bank", () => {
    expect(referenceOf({ reference: "0012345", issuer: "Zz Banque" })).toBe("0012345, Zz Banque");
    expect(referenceOf({ reference: null, issuer: null })).toBeNull();
  });

  it("sorts the amount in cents", () => expect(journalValue(ROWS[0], "montant", TODAY)).toBe(12000));
});

describe("shownJournal", () => {
  it("keeps the period's order without filter nor sort", () =>
    expect(shownJournal(ROWS, EMPTY_FILTER, null, TODAY)).toEqual(ROWS));

  it("filters the method by checkboxes", () =>
    expect(shownJournal(ROWS, filter("moyen.parmi.Chèque"), null, TODAY).map((r) => r.payer)).toEqual([
      "Zz Martin",
      "Zz Arnaud",
    ]));

  it("filters payments not yet deposited (empty « Remise »)", () =>
    expect(shownJournal(ROWS, filter("remise.vide"), null, TODAY).map((r) => r.payer)).toEqual([
      "Zz Martin",
      "Zz Bernard",
      "Zz Durand",
    ]));

  it("sorts by amount, a correction (negative) first in ascending order", () =>
    expect(
      shownJournal(ROWS, EMPTY_FILTER, { column: "montant", direction: "asc" }, TODAY).map((r) => r.amountCents),
    ).toEqual([-2000, 3500, 9000, 12000]));

  it("ignores a filter on the amount (not filterable)", () =>
    expect(shownJournal(ROWS, filter("montant.sup_egal.100"), null, TODAY)).toHaveLength(4));
});
