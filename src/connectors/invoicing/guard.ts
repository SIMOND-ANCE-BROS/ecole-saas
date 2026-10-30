import {
  type Capabilities,
  type InvoicingConnector,
  InvoicingError,
  type InvoicingOperation,
  type ToolClient,
  type ToolDocument,
} from "./contract";

/** ADR 0007: every call gives up after 10 s. */
export const TIMEOUT_MS = 10_000;
/** Pause before the single retry of a network or 5xx failure. */
export const RETRY_PAUSE_MS = 500;

export type GuardOptions = {
  capabilities: Capabilities;
  timeoutMs?: number;
  pauseMs?: number;
};

/**
 * Wraps a tool's raw client into the contract every caller relies on: each call
 * times out (10 s), a network or server failure is retried once after a short
 * pause (a timeout is not: the outbox tries again later, idempotently), any
 * failure surfaces as an `InvoicingError`, and a document whose VAT-inclusive
 * total differs from ours is rejected (`total_mismatch`, ADR 0007).
 */
export function guarded(client: ToolClient, options: GuardOptions): InvoicingConnector {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const pauseMs = options.pauseMs ?? RETRY_PAUSE_MS;
  const capabilities: Capabilities = {
    recordPayment: options.capabilities.recordPayment && client.supportsRecordPayment,
  };

  async function call<T>(operation: InvoicingOperation, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        // A client that ignores its signal still gives up on time.
        return await Promise.race([run(signal), rejectedWhenAborted(signal)]);
      } catch (e) {
        const error = typed(e, operation, signal);
        if (attempt === 0 && (error.kind === "network" || error.kind === "server")) {
          await pause(pauseMs);
          continue;
        }
        throw error;
      }
    }
  }

  // On a mismatch the error carries the tool's document: once issued, it is numbered there
  // and must be recorded (then corrected by a credit note), never forgotten.
  const checked = (operation: InvoicingOperation, ours: number) => (doc: ToolDocument) => {
    if (doc.totalInclTaxCents !== ours) throw new InvoicingError("rejected", operation, "total_mismatch", doc);
    return doc;
  };

  return {
    tool: client.tool,
    capabilities,
    checkCredentials: () => call("checkCredentials", (s) => client.checkCredentials(s)),
    createCustomer: (customer) => call("createCustomer", (s) => client.createCustomer(customer, s)),
    createInvoice: (invoice) =>
      call("createInvoice", (s) => client.createInvoice(invoice, s)).then(
        checked("createInvoice", invoice.totals.inclTaxCents),
      ),
    finalize: (draft) =>
      call("finalize", (s) => client.finalize(draft.toolRef, s)).then(checked("finalize", draft.totalInclTaxCents)),
    createCreditNote: (creditNote) =>
      call("createCreditNote", (s) => client.createCreditNote(creditNote, s)).then(
        checked("createCreditNote", creditNote.totals.inclTaxCents),
      ),
    readStatus: (toolRef) => call("readStatus", (s) => client.readStatus(toolRef, s)),
    recordPayment: async (payment) => {
      if (!capabilities.recordPayment)
        throw new InvoicingError("unsupported", "recordPayment", "payment_e_reporting_off");
      return call("recordPayment", (s) => client.recordPayment(payment, s));
    },
  };
}

/** Whatever was thrown, as an `InvoicingError`; the original error (and its text) is dropped. */
function typed(e: unknown, operation: InvoicingOperation, signal: AbortSignal): InvoicingError {
  if (e instanceof InvoicingError) {
    return e.operation === operation ? e : new InvoicingError(e.kind, operation, e.code, e.document);
  }
  if (signal.aborted || (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError"))) {
    return new InvoicingError("timeout", operation);
  }
  return new InvoicingError("network", operation);
}

const rejectedWhenAborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
