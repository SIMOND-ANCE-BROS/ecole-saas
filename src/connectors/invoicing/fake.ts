import { z } from "zod";
import { FAKE_NUMBER_PREFIX } from "../../domain/billing/invoicing";
import { has } from "../../lib/has";
import {
  type CreditNotePayload,
  type CustomerPayload,
  type InvoicePayload,
  InvoicingError,
  type PaymentPayload,
  type ToolClient,
  type ToolDocument,
} from "./contract";

/**
 * Simulation tool (#303): behaves like an invoicing tool without leaving the
 * server, for the contract tests and for a school trying the software. Its
 * numbers start with « TEST- » and mean nothing; `connectorFor` refuses it
 * unless `INVOICING_FAKE_ALLOWED=1`, and the interface shows « Mode simulation ».
 *
 * Its documents live in memory, one store per billing entity, kept across
 * requests of the same server process only: after a restart, or on another
 * instance, they are gone (`not_found`), as with a tool account emptied. A
 * number is derived from our own id, so the same invoice sent again gets the
 * same number.
 */

/** Credentials of the fake tool: any non-empty token; « refuse » plays wrong credentials. */
export const FAKE_CREDENTIALS = z.object({ token: z.string().min(1) });
export type FakeCredentials = z.infer<typeof FAKE_CREDENTIALS>;
export const FAKE_REFUSED_TOKEN = "refuse";

/** Failures the tests make the fake play, consumed one call at a time. */
export type FakeFault =
  /** Never answers (the guard's timeout fires). */
  | { kind: "hang" }
  | { kind: "network" }
  /** A 5xx answer. */
  | { kind: "server" }
  /** The tool does the work, then its answer is lost (a 5xx on the way back). */
  | { kind: "lost_response" }
  /** The document is refused (a 4xx answer). */
  | { kind: "rejected" }
  /** The tool's VAT-inclusive total differs from ours by this many cents. */
  | { kind: "total_offset"; cents: number };

type Stored = ToolDocument & {
  externalRef: string;
  kind: "invoice" | "credit_note";
  customerRef: string;
  payments: Set<string>;
  /** Credit notes issued against it, as a positive amount. */
  creditedCents: number;
};

export type FakeStore = {
  customers: Map<string, string>;
  documents: Map<string, Stored>;
  byExternalRef: Map<string, string>;
  faults: FakeFault[];
  /** Calls received, by operation, for the tests (no payload kept). */
  calls: string[];
};

export const newFakeStore = (): FakeStore => ({
  customers: new Map(),
  documents: new Map(),
  byExternalRef: new Map(),
  faults: [],
  calls: [],
});

// One store per billing entity for the whole server process (and across hot reloads in dev).
const holder = globalThis as typeof globalThis & { __fakeInvoicingStores?: Map<string, FakeStore> };
export function fakeStoreOf(billingEntityId: string): FakeStore {
  holder.__fakeInvoicingStores ??= new Map();
  let store = holder.__fakeInvoicingStores.get(billingEntityId);
  if (!store) {
    store = newFakeStore();
    holder.__fakeInvoicingStores.set(billingEntityId, store);
  }
  return store;
}

/** « TEST-F-1A2B3C4D5E6F » for an invoice, « TEST-A-… » for a credit note (avoir). */
const numberOf = (kind: Stored["kind"], externalRef: string) =>
  `${FAKE_NUMBER_PREFIX}${kind === "invoice" ? "F" : "A"}-${externalRef.replace(/-/g, "").slice(0, 12).toUpperCase()}`;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

/** The document as answered; `offsetCents` plays a tool whose total differs from ours. */
const view = (doc: Stored, offsetCents = 0): ToolDocument => ({
  toolRef: doc.toolRef,
  status: doc.status,
  number: doc.number,
  issuedOn: doc.issuedOn,
  totalInclTaxCents: doc.totalInclTaxCents + offsetCents,
  pdfUrl: doc.pdfUrl,
});

export function fakeTool(store: FakeStore, credentials: FakeCredentials): ToolClient {
  /** Plays the next queued failure, if any. */
  async function answer<T>(operation: string, signal: AbortSignal, run: (offsetCents: number) => T): Promise<T> {
    store.calls.push(operation);
    const fault = store.faults.shift();
    if (fault?.kind === "hang") {
      await new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    }
    if (fault?.kind === "network") throw new TypeError("fetch failed");
    if (fault?.kind === "server") throw new InvoicingError("server", "connectorFor", "status_503");
    if (fault?.kind === "rejected") throw new InvoicingError("rejected", "connectorFor", "status_422");
    if (credentials.token === FAKE_REFUSED_TOKEN) throw new InvoicingError("credentials", "connectorFor", "status_401");
    const result = run(fault?.kind === "total_offset" ? fault.cents : 0);
    if (fault?.kind === "lost_response") throw new InvoicingError("server", "connectorFor", "status_504");
    return result;
  }

  function create(
    kind: Stored["kind"],
    payload: InvoicePayload | CreditNotePayload,
    offsetCents: number,
  ): ToolDocument {
    const existing = store.byExternalRef.get(payload.externalRef);
    if (existing) return view(found(existing), offsetCents);
    if (![...store.customers.values()].includes(payload.customerRef)) {
      throw new InvoicingError("rejected", "connectorFor", "unknown_customer");
    }
    const linesTotal = payload.lines.reduce((sum, line) => sum + line.inclTaxCents, 0);
    if (linesTotal !== payload.totals.inclTaxCents) throw new InvoicingError("rejected", "connectorFor", "lines_total");
    if (has(payload, "creditedToolRef")) {
      const credited = found(payload.creditedToolRef);
      if (credited.status !== "issued") throw new InvoicingError("rejected", "connectorFor", "credited_not_issued");
      if (credited.customerRef !== payload.customerRef) {
        throw new InvoicingError("rejected", "connectorFor", "credited_other_customer");
      }
      // A credit note cancels all or part of the invoice, never more.
      const amount = -payload.totals.inclTaxCents;
      if (amount <= 0 || credited.creditedCents + amount > credited.totalInclTaxCents) {
        throw new InvoicingError("rejected", "connectorFor", "credit_exceeds_invoice");
      }
      credited.creditedCents += amount;
    }
    const toolRef = `fake_${kind}_${payload.externalRef}`;
    const doc: Stored = {
      toolRef,
      externalRef: payload.externalRef,
      kind,
      status: "draft",
      number: null,
      issuedOn: null,
      totalInclTaxCents: linesTotal,
      pdfUrl: null,
      customerRef: payload.customerRef,
      payments: new Set(),
      creditedCents: 0,
    };
    store.documents.set(toolRef, doc);
    store.byExternalRef.set(payload.externalRef, toolRef);
    // A credit note is issued straight away, as the tools do.
    return view(kind === "credit_note" ? issue(doc) : doc, offsetCents);
  }

  function found(toolRef: string): Stored {
    const doc = store.documents.get(toolRef);
    if (!doc) throw new InvoicingError("not_found", "connectorFor", "unknown_document");
    return doc;
  }

  function issue(doc: Stored): Stored {
    if (doc.status === "draft") {
      doc.status = "issued";
      doc.number = numberOf(doc.kind, doc.externalRef);
      doc.issuedOn = today();
    }
    return doc;
  }

  return {
    tool: "fake",
    supportsRecordPayment: true,
    checkCredentials: (signal) => answer("checkCredentials", signal, () => undefined),
    createCustomer: (customer: CustomerPayload, signal) =>
      answer("createCustomer", signal, () => {
        let customerRef = store.customers.get(customer.externalRef);
        if (!customerRef) {
          customerRef = `fake_customer_${customer.externalRef}`;
          store.customers.set(customer.externalRef, customerRef);
        }
        return { customerRef };
      }),
    createInvoice: (invoice, signal) => answer("createInvoice", signal, (offset) => create("invoice", invoice, offset)),
    finalize: (toolRef, signal) => answer("finalize", signal, (offset) => view(issue(found(toolRef)), offset)),
    createCreditNote: (creditNote, signal) =>
      answer("createCreditNote", signal, (offset) => create("credit_note", creditNote, offset)),
    readStatus: (toolRef, signal) => answer("readStatus", signal, (offset) => view(found(toolRef), offset)),
    recordPayment: (payment: PaymentPayload, signal) =>
      answer("recordPayment", signal, () => {
        const doc = found(payment.invoiceToolRef);
        if (doc.status !== "issued") throw new InvoicingError("rejected", "connectorFor", "invoice_not_issued");
        doc.payments.add(payment.externalRef);
      }),
  };
}
