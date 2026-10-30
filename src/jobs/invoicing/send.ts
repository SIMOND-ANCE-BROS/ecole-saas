import { after } from "next/server";
import { type ConnectorOptions, connectorFor, type EntityConnectorConfig } from "../../connectors/invoicing/connector";
import { type InvoicingConnector, InvoicingError, type ToolDocument } from "../../connectors/invoicing/contract";
import { invoicePayload } from "../../connectors/invoicing/payload";
import { withSchool } from "../../db";
import {
  type Claimed,
  claimDue,
  connectorConfigOf,
  dueWork,
  loadForSending,
  recordCancelled,
  recordFailure,
  recordIssued,
  recordToolDraft,
  type Sendable,
} from "../../db/invoice-outbox";
import { numberFitsTool } from "../../domain/billing/invoicing";
import { afterFailure, BATCH_SIZE, type SendFailure } from "../../domain/invoicing/outbox";
import type { ToolAnswer } from "../../domain/invoicing/progress";
import { displayedName } from "../../domain/people/name";

/**
 * Sends the invoices of each business to its own invoicing tool (#304, ADR 0007). The invoice
 * row is the outbox: a run claims one due invoice in a short transaction, calls the tool outside
 * any transaction, records each step in its own transaction, then claims the next one.
 * Idempotent by invoice id: an invoice sent again after a lost answer is the same document in
 * the tool. Logs carry technical ids, kinds and codes only, never personal data nor a tool's text.
 */

export type RunOptions = ConnectorOptions & { batchSize?: number };

/** What one run did for one business: counts only. */
export type EntityReport = {
  claimed: number;
  issued: number;
  retried: number;
  rejected: number;
  cancelled: number;
  /** Claims another run took over before this one recorded its result (it records nothing). */
  lost: number;
  /** Why nothing was claimed although work was due (technical code), e.g. `fake_not_allowed`. */
  skipped: string | null;
};

const emptyReport = (): EntityReport => ({
  claimed: 0,
  issued: 0,
  retried: 0,
  rejected: 0,
  cancelled: 0,
  lost: 0,
  skipped: null,
});

/**
 * Sends the due invoices of one business of one school, up to `batchSize`. Its connector is
 * built from its own `invoicing_connector` row, read under that school's RLS; a business whose
 * connector cannot be built (fake tool refused here, unreadable credentials, tool not available
 * yet) is skipped without counting an attempt: its invoices wait, untouched. Invoices are claimed
 * one at a time, just before being sent: a claim never runs out while earlier invoices of the
 * batch are still on their way to a slow tool.
 */
export async function sendEntityInvoices(
  schoolId: string,
  billingEntityId: string,
  options: RunOptions = {},
): Promise<EntityReport> {
  const report = emptyReport();
  type Start = { ok: false; skipped: string } | { ok: true; connector: InvoicingConnector };
  const start = await withSchool(schoolId, async (tx): Promise<Start> => {
    const config = await connectorConfigOf(tx, billingEntityId);
    if (!config) return { ok: false, skipped: "no_active_connector" };
    try {
      return { ok: true, connector: connectorFor(config, options) };
    } catch (e) {
      if (e instanceof InvoicingError) return { ok: false, skipped: e.code ?? e.kind };
      throw e;
    }
  });
  if (!start.ok) {
    report.skipped = start.skipped;
    return report;
  }
  const batch = options.batchSize ?? BATCH_SIZE;
  while (report.claimed < batch) {
    const [claimed] = await withSchool(schoolId, (tx) => claimDue(tx, billingEntityId, 1));
    if (!claimed) break;
    report.claimed += 1;
    report[await sendOne(schoolId, start.connector, claimed)] += 1;
  }
  return report;
}

type Outcome = "issued" | "retried" | "rejected" | "cancelled" | "lost";

/** The tool's id of the document once known: kept on a rejection, so its lines stay billed. */
type Known = { toolRef: string | null };

async function sendOne(schoolId: string, connector: InvoicingConnector, c: Claimed): Promise<Outcome> {
  const known: Known = { toolRef: c.status === "tool_draft" ? c.toolRef : null };
  let expected: number | null = null;
  try {
    const invoice = await withSchool(schoolId, (tx) => loadForSending(tx, c.id));
    if (!invoice) throw new Error("claimed invoice not found");
    expected = invoice.totals.inclTaxCents;
    let toolRef = known.toolRef;

    if (toolRef) {
      // Sent before: where does the tool stand? Its answer may have been lost after it issued.
      const doc = await readOrForget(connector, toolRef);
      if (doc?.status === "issued") return await issued(schoolId, connector, c, doc, expected);
      if (doc?.status === "cancelled") {
        return (await withSchool(schoolId, (tx) => recordCancelled(tx, c))) ? "cancelled" : lostClaim(c);
      }
      if (doc?.status === "rejected") throw new InvoicingError("rejected", "readStatus", "tool_rejected");
      if (!doc) {
        // Gone from the tool (the fake's memory after a restart): create it again.
        toolRef = null;
        known.toolRef = null;
      }
    }

    if (!toolRef) {
      const draft = await connector.createInvoice(await payloadOf(connector, invoice));
      known.toolRef = draft.toolRef;
      if (draft.status === "issued") return await issued(schoolId, connector, c, draft, expected);
      if (!(await withSchool(schoolId, (tx) => recordToolDraft(tx, c, connector.tool, draft.toolRef)))) {
        return lostClaim(c);
      }
      toolRef = draft.toolRef;
    }

    const doc = await connector.finalize({ toolRef, totalInclTaxCents: expected });
    return await issued(schoolId, connector, c, doc, expected);
  } catch (e) {
    // A document the tool returned with the failure (a total mismatch…): it holds it.
    if (e instanceof InvoicingError && e.document) known.toolRef ??= e.document.toolRef;
    // The tool issued and numbered it, with another total: recorded as issued all the same (#303).
    if (
      e instanceof InvoicingError &&
      e.code === "total_mismatch" &&
      e.document?.status === "issued" &&
      e.document.number &&
      expected !== null
    ) {
      try {
        return await issued(schoolId, connector, c, e.document, expected);
      } catch (inner) {
        return failed(schoolId, connector, c, known, inner);
      }
    }
    return failed(schoolId, connector, c, known, e);
  }
}

/**
 * What a business's tool says of one of its documents (#352, before « Abandonner »): its status,
 * `not_found`, or `unreachable` when its connector cannot be built here or the call fails (with
 * the guard's timeout and retries). Called outside any transaction; logs technical facts only.
 */
export async function toolAnswerOf(
  config: EntityConnectorConfig | null,
  toolRef: string,
  options: ConnectorOptions = {},
): Promise<ToolAnswer> {
  if (!config) return "unreachable";
  try {
    const doc = await readOrForget(connectorFor(config, options), toolRef);
    return doc ? doc.status : "not_found";
  } catch (e) {
    console.error(
      `Business ${config.billingEntityId}: tool status not read`,
      e instanceof InvoicingError ? `${e.kind}${e.code ? `: ${e.code}` : ""}` : e instanceof Error ? e.name : "",
    );
    return "unreachable";
  }
}

/** The tool's document, or null when the tool no longer knows it. */
async function readOrForget(connector: InvoicingConnector, toolRef: string): Promise<ToolDocument | null> {
  try {
    return await connector.readStatus(toolRef);
  } catch (e) {
    if (e instanceof InvoicingError && e.kind === "not_found") return null;
    throw e;
  }
}

async function payloadOf(connector: InvoicingConnector, invoice: Sendable) {
  const { customerRef } = await connector.createCustomer({
    externalRef: invoice.payer.id,
    kind: invoice.payer.type,
    name: displayedName(invoice.payer),
    email: invoice.payer.email,
    addressLine: invoice.payer.address,
    postalCode: null,
    city: null,
  });
  return invoicePayload({
    invoiceId: invoice.id,
    customerRef,
    vatMention: invoice.vatMention,
    totals: invoice.totals,
    lines: invoice.lines,
    installments: invoice.installments,
  });
}

/**
 * Records a document the tool issued. Its VAT-inclusive total is compared with ours here,
 * whatever call returned it (the guard does not check `readStatus`, read after a lost answer):
 * a difference is recorded all the same, with the tool's total, flagged for a credit note (#303).
 */
async function issued(
  schoolId: string,
  connector: InvoicingConnector,
  c: Claimed,
  doc: ToolDocument,
  expectedInclTaxCents: number,
): Promise<Outcome> {
  if (doc.status !== "issued" || !doc.number || !doc.issuedOn) {
    throw new InvoicingError("format", "finalize", "issued_without_number");
  }
  // The database refuses a « TEST- » number from a real tool, and any other from the fake one.
  if (!numberFitsTool(connector.tool, doc.number)) throw new MismatchedNumber();
  const number = doc.number;
  const issuedOn = doc.issuedOn;
  const mismatch = doc.totalInclTaxCents !== expectedInclTaxCents;
  const done = await withSchool(schoolId, (tx) =>
    recordIssued(tx, c, connector.tool, { ...doc, number, issuedOn }, mismatch),
  );
  return done ? "issued" : lostClaim(c);
}

class MismatchedNumber extends Error {
  readonly failure: SendFailure = { kind: "number_tool_mismatch", code: null };
}

function failureOf(e: unknown): SendFailure {
  if (e instanceof MismatchedNumber) return e.failure;
  if (e instanceof InvoicingError) return { kind: e.kind, code: e.code };
  return { kind: "internal", code: null };
}

async function failed(
  schoolId: string,
  connector: InvoicingConnector,
  c: Claimed,
  known: Known,
  e: unknown,
): Promise<Outcome> {
  const failure = failureOf(e);
  const decision = afterFailure(failure, c.attempts);
  // Technical facts only: an unknown error's message may quote data, so only its name is kept.
  console.error(
    `Invoice ${c.id}: sending failed (${failure.kind}${failure.code ? `: ${failure.code}` : ""}, attempt ${c.attempts})`,
    failure.kind === "internal" && e instanceof Error ? e.name : "",
  );
  const delay = decision.status === "retry" ? decision.delayMinutes : null;
  const held = known.toolRef ? { tool: connector.tool, toolRef: known.toolRef } : null;
  const done = await withSchool(schoolId, (tx) => recordFailure(tx, c, failure, delay, held));
  if (!done) return lostClaim(c);
  return decision.status === "retry" ? "retried" : "rejected";
}

/** Another run took the invoice over after our claim ran out: it carries on, we record nothing. */
function lostClaim(c: Claimed): Outcome {
  console.error(`Invoice ${c.id}: claim lost before recording, left to the run holding it`);
  return "lost";
}

export type SweepReport = { pairs: number; failedPairs: number } & Omit<EntityReport, "skipped"> & {
    skipped: number;
  };

/**
 * One sweep over every school (the sweep route): the due (school, business) pairs, each sent
 * on its own; a business failing does not stop the others, the next sweep catches up.
 * `schoolId` limits it to one school (`sendSoon`).
 */
export async function sweep(options: RunOptions & { schoolId?: string } = {}): Promise<SweepReport> {
  const total: SweepReport = {
    pairs: 0,
    failedPairs: 0,
    claimed: 0,
    issued: 0,
    retried: 0,
    rejected: 0,
    cancelled: 0,
    lost: 0,
    skipped: 0,
  };
  const pairs = (await dueWork()).filter((w) => !options.schoolId || w.schoolId === options.schoolId);
  for (const w of pairs) {
    total.pairs += 1;
    try {
      const r = await sendEntityInvoices(w.schoolId, w.billingEntityId, options);
      total.claimed += r.claimed;
      total.issued += r.issued;
      total.retried += r.retried;
      total.rejected += r.rejected;
      total.cancelled += r.cancelled;
      total.lost += r.lost;
      if (r.skipped) {
        total.skipped += 1;
        console.error(`Business ${w.billingEntityId} of school ${w.schoolId}: not sent (${r.skipped})`);
      }
    } catch (e) {
      total.failedPairs += 1;
      console.error(
        `Business ${w.billingEntityId} of school ${w.schoolId}: sending run failed`,
        e instanceof Error ? e.name : "",
      );
    }
  }
  return total;
}

/**
 * Sends the school's due invoices once the response is gone (`after()`), from the server action
 * that drafts them: the front desk never waits for a tool. `schoolId` comes from the server-side
 * session of that action (`requireRole()`), never from the browser. The sweep route catches
 * whatever this misses (server stopped, tool down).
 */
export function sendSoon(schoolId: string): void {
  after(async () => {
    try {
      await sweep({ schoolId });
    } catch (e) {
      console.error(`School ${schoolId}: sending after the response failed`, e instanceof Error ? e.name : "");
    }
  });
}
