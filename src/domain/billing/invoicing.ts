/**
 * Invoicing tools and what they are trusted with (#303, ADR 0007). Pure
 * constants shared by the schema and the connectors.
 */

/** Tools a business can send its invoices through; `fake` is the simulation tool. */
export const INVOICING_TOOLS = ["pennylane", "abby", "shine", "fake"] as const;
export type InvoicingToolName = (typeof INVOICING_TOOLS)[number];

/**
 * Prefix of every number the fake tool gives; the database refuses it on an
 * invoice of a real tool, and refuses any other number on a fake one. The check
 * (`invoice_fake_number`, migration 0054) spells it out: changing it needs a
 * new migration, and it must stay free of quotes.
 */
export const FAKE_NUMBER_PREFIX = "TEST-";

/**
 * Whether payments are e-reported through the invoicing tool (`recordPayment`).
 * Open question #303 Q1 (does payment e-reporting apply to the school's B2C
 * sales?), default approved by the owner: off until the accountant confirms.
 */
export const PAYMENT_E_REPORTING = false;

/**
 * Whether the database accepts `number` on an invoice of `tool` (CHECK `invoice_fake_number`):
 * a « TEST- » number from the fake tool only, and no other number from it. Checked before the
 * number is written, so a tool breaking the rule ends as a structured failure, not a crash.
 */
export const numberFitsTool = (tool: InvoicingToolName, number: string): boolean =>
  number.startsWith(FAKE_NUMBER_PREFIX) === (tool === "fake");
