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
 * requests of the same server process. A number is derived from our own id, so
 * a restarted server gives the same document the same number again.
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
  /** The document is refused (a 4xx answer). */
  | { kind: "rejected" }
  /** The tool's VAT-inclusive total differs from ours by this many cents. */
  | { kind: "total_offset"; cents: number };

type Stored = ToolDocument & { externalRef: string; kind: "invoice" | "credit_note"; payments: Set<string> };

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
    return run(fault?.kind === "total_offset" ? fault.cents : 0);
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
    if (has(payload, "creditedToolRef")) {
      const credited = found(payload.creditedToolRef);
      if (credited.status !== "issued") throw new InvoicingError("rejected", "connectorFor", "credited_not_issued");
    }
    const linesTotal = payload.lines.reduce((sum, line) => sum + line.inclTaxCents, 0);
    if (linesTotal !== payload.totals.inclTaxCents) throw new InvoicingError("rejected", "connectorFor", "lines_total");
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
      payments: new Set(),
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
