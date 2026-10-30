/**
 * Invoicing tools and what they are trusted with (#303, ADR 0007). Pure
 * constants shared by the schema and the connectors.
 */

/** Tools a business can send its invoices through; `fake` is the simulation tool. */
export const INVOICING_TOOLS = ["pennylane", "abby", "shine", "fake"] as const;
export type InvoicingToolName = (typeof INVOICING_TOOLS)[number];

/**
 * Prefix of every number the fake tool gives; the database refuses it on an
 * invoice of a real tool, and refuses any other number on a fake one.
 */
export const FAKE_NUMBER_PREFIX = "TEST-";

/**
 * Whether payments are e-reported through the invoicing tool (`recordPayment`).
 * Open question #303 Q1 (does payment e-reporting apply to the school's B2C
 * sales?), default approved by the owner: off until the accountant confirms.
 */
export const PAYMENT_E_REPORTING = false;
