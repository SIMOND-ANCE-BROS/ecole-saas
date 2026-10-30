import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { encrypt } from "../../lib/encryption";
import { FAKE_NUMBER_PREFIX, PAYMENT_E_REPORTING } from "../../domain/billing/invoicing";
import { type CustomerPayload, type InvoicePayload, type InvoicingConnector, InvoicingError } from "./contract";
import { connectorFor } from "./connector";
import { FAKE_REFUSED_TOKEN, type FakeFault, fakeStoreOf } from "./fake";
import { invoicePayload, type StoredLine } from "./payload";

/**
 * Contract tests (#303, ADR 0007), run against the fake tool: every real
 * connector will have to pass the same ones. Fictitious data only.
 */

const ALLOWED = { INVOICING_FAKE_ALLOWED: "1" };
// Quick timings: the defaults (10 s, 500 ms) are asserted separately.
const FAST = { env: ALLOWED, timeoutMs: 50, pauseMs: 1 };

let entityId: string;
const credentials = (token = "zz-jeton-de-test") => encrypt(JSON.stringify({ token }));
const make = (options: Parameters<typeof connectorFor>[1] = FAST, token?: string) =>
  connectorFor({ billingEntityId: entityId, tool: "fake", encryptedCredentials: credentials(token) }, options);
const inject = (...faults: FakeFault[]) => fakeStoreOf(entityId).faults.push(...faults);

const CUSTOMER: CustomerPayload = {
  externalRef: "",
  kind: "individual",
  name: "Zzmartin Zoé",
  email: "zoe@exemple.test",
  addressLine: "1 rue des Zz",
  postalCode: "69100",
  city: "Zzville",
};

// 3 × 100,00 € TTC at 20 %: 50,00 € of VAT for the treatment, 16,67 + 16,67 + 16,66 per line;
// a tool computing VAT line by line would find 50,01 € (#301): the lines go as stored.
const LINES: StoredLine[] = [
  ...[1667, 1667, 1666].map((vatCents, i) => ({
    label: `Zz forfait ${i + 1}`,
    quantityThousandths: 1000,
    inclTaxCents: 10000,
    exclTaxCents: 10000 - vatCents,
    vatCents,
    vatCategory: "standard" as const,
    vatRateBps: 2000,
    vatMention: null,
  })),
  {
    label: "Zz cours exonéré",
    quantityThousandths: 1000,
    inclTaxCents: 4150,
    exclTaxCents: 4150,
    vatCents: 0,
    vatCategory: "exempt",
    vatRateBps: 0,
    vatMention: "Zz mention d’exonération",
  },
];

async function draft(connector: InvoicingConnector): Promise<{ payload: InvoicePayload; toolRef: string }> {
  const { customerRef } = await connector.createCustomer({ ...CUSTOMER, externalRef: randomUUID() });
  const payload = invoicePayload({
    invoiceId: randomUUID(),
    customerRef,
    vatMention: null,
    lines: LINES,
    installments: [{ dueDate: "2027-09-15", amountCents: 34150 }],
  });
  const doc = await connector.createInvoice(payload);
  return { payload, toolRef: doc.toolRef };
}

beforeEach(() => {
  process.env.CLE_CHIFFREMENT = randomBytes(32).toString("base64");
  // A new business each test: a store of its own.
  entityId = randomUUID();
});

describe("invoice payload", () => {
  it("sends each line's amounts as stored, with the rate or the mention", () => {
    const payload = invoicePayload({
      invoiceId: "i",
      customerRef: "c",
      vatMention: null,
      lines: LINES,
      installments: [],
    });
    expect(payload.lines.map((l) => [l.inclTaxCents, l.exclTaxCents, l.vatCents])).toEqual([
      [10000, 8333, 1667],
      [10000, 8333, 1667],
      [10000, 8334, 1666],
      [4150, 4150, 0],
    ]);
    expect(payload.lines[0].vat).toEqual({ category: "standard", rateBps: 2000 });
    expect(payload.lines[3].vat).toEqual({ category: "exempt", mention: "Zz mention d’exonération" });
    expect(payload.totals).toEqual({ inclTaxCents: 34150, exclTaxCents: 29150, vatCents: 5000 });
  });
});

describe("invoicing contract: fake tool", () => {
  it("checks credentials, and reports wrong ones as such", async () => {
    await expect(make().checkCredentials()).resolves.toBeUndefined();
    await expect(make(FAST, FAKE_REFUSED_TOKEN).checkCredentials()).rejects.toMatchObject({
      kind: "credentials",
      operation: "checkCredentials",
      retryable: false,
    });
  });

  it("creates a customer once per payer", async () => {
    const connector = make();
    const externalRef = randomUUID();
    const first = await connector.createCustomer({ ...CUSTOMER, externalRef });
    const again = await connector.createCustomer({ ...CUSTOMER, externalRef });
    expect(again.customerRef).toBe(first.customerRef);
  });

  it("creates an unnumbered draft whose total is ours", async () => {
    const connector = make();
    const { payload, toolRef } = await draft(connector);
    const status = await connector.readStatus(toolRef);
    expect(status).toMatchObject({ status: "draft", number: null, issuedOn: null, totalInclTaxCents: 34150 });
    expect(payload.totals.inclTaxCents).toBe(34150);
  });

  it("returns the first draft when the same invoice is sent again (idempotent retry)", async () => {
    const connector = make();
    const { payload, toolRef } = await draft(connector);
    const again = await connector.createInvoice(payload);
    expect(again.toolRef).toBe(toolRef);
    expect(fakeStoreOf(entityId).documents.size).toBe(1);
  });

  it("finalizes: the tool numbers the invoice « TEST-… », once", async () => {
    const connector = make();
    const { payload, toolRef } = await draft(connector);
    const issued = await connector.finalize({ toolRef, totalInclTaxCents: payload.totals.inclTaxCents });
    expect(issued.status).toBe("issued");
    expect(issued.number?.startsWith(FAKE_NUMBER_PREFIX)).toBe(true);
    expect(issued.issuedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const again = await connector.finalize({ toolRef, totalInclTaxCents: payload.totals.inclTaxCents });
    expect(again.number).toBe(issued.number);
    expect(await connector.readStatus(toolRef)).toEqual(issued);
  });

  it("issues a credit note of an issued invoice, numbered by the tool", async () => {
    const connector = make();
    const { payload, toolRef } = await draft(connector);
    const issued = await connector.finalize({ toolRef, totalInclTaxCents: 34150 });
    const negative = LINES.map((l) => ({
      ...l,
      inclTaxCents: -l.inclTaxCents,
      exclTaxCents: -l.exclTaxCents,
      vatCents: -l.vatCents,
    }));
    const credit = invoicePayload({ ...payload, invoiceId: randomUUID(), lines: negative, installments: [] });
    const note = await connector.createCreditNote({ ...credit, creditedToolRef: toolRef });
    expect(note).toMatchObject({ status: "issued", totalInclTaxCents: -34150 });
    expect(note.number?.startsWith(FAKE_NUMBER_PREFIX)).toBe(true);
    expect(note.number).not.toBe(issued.number);
  });

  it("refuses a credit note of a draft", async () => {
    const connector = make();
    const { payload, toolRef } = await draft(connector);
    await expect(
      connector.createCreditNote({ ...payload, externalRef: randomUUID(), creditedToolRef: toolRef }),
    ).rejects.toMatchObject({ kind: "rejected", operation: "createCreditNote" });
  });

  it("reports an unknown document as not found", async () => {
    await expect(make().readStatus("fake_invoice_zz")).rejects.toMatchObject({
      kind: "not_found",
      operation: "readStatus",
    });
  });
});

describe("invoicing contract: totals", () => {
  it("rejects a draft whose VAT-inclusive total differs from ours by a cent", async () => {
    const connector = make();
    const { customerRef } = await connector.createCustomer({ ...CUSTOMER, externalRef: randomUUID() });
    inject({ kind: "total_offset", cents: 1 });
    const payload = invoicePayload({
      invoiceId: randomUUID(),
      customerRef,
      vatMention: null,
      lines: LINES,
      installments: [],
    });
    const error = await connector.createInvoice(payload).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvoicingError);
    expect(error).toMatchObject({
      kind: "rejected",
      code: "total_mismatch",
      operation: "createInvoice",
      retryable: false,
    });
  });

  it("rejects an issued invoice whose total differs from ours", async () => {
    const connector = make();
    const { toolRef } = await draft(connector);
    inject({ kind: "total_offset", cents: -1 });
    await expect(connector.finalize({ toolRef, totalInclTaxCents: 34150 })).rejects.toMatchObject({
      kind: "rejected",
      code: "total_mismatch",
    });
  });
});

describe("invoicing contract: timeout and retry", () => {
  it("gives up after the timeout, without retrying", async () => {
    const connector = make();
    inject({ kind: "hang" }, { kind: "hang" });
    await expect(connector.checkCredentials()).rejects.toMatchObject({ kind: "timeout", retryable: true });
    expect(fakeStoreOf(entityId).calls).toEqual(["checkCredentials"]);
  });

  it("retries once a network or server failure, then succeeds", async () => {
    const connector = make();
    inject({ kind: "network" });
    await expect(connector.checkCredentials()).resolves.toBeUndefined();
    inject({ kind: "server" });
    await expect(connector.checkCredentials()).resolves.toBeUndefined();
    expect(fakeStoreOf(entityId).calls).toHaveLength(4);
  });

  it("stops after a single retry", async () => {
    const connector = make();
    inject({ kind: "server" }, { kind: "server" }, { kind: "server" });
    await expect(connector.checkCredentials()).rejects.toMatchObject({ kind: "server", retryable: true });
    expect(fakeStoreOf(entityId).calls).toHaveLength(2);
  });

  it("does not retry a refusal", async () => {
    const connector = make();
    inject({ kind: "rejected" });
    await expect(connector.checkCredentials()).rejects.toMatchObject({ kind: "rejected", retryable: false });
    expect(fakeStoreOf(entityId).calls).toHaveLength(1);
  });

  it("a retried creation gives one document (idempotent by our id)", async () => {
    const connector = make();
    const { customerRef } = await connector.createCustomer({ ...CUSTOMER, externalRef: randomUUID() });
    const payload = invoicePayload({
      invoiceId: randomUUID(),
      customerRef,
      vatMention: null,
      lines: LINES,
      installments: [],
    });
    inject({ kind: "server" });
    const doc = await connector.createInvoice(payload);
    await connector.createInvoice(payload);
    expect(fakeStoreOf(entityId).documents.size).toBe(1);
    expect(doc.status).toBe("draft");
  });

  it("names no personal data in its error message", async () => {
    const connector = make();
    inject({ kind: "rejected" });
    const error = await connector.createCustomer({ ...CUSTOMER, externalRef: randomUUID() }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvoicingError);
    const text = `${String(error)} ${JSON.stringify(error)}`;
    for (const value of [CUSTOMER.name, CUSTOMER.email, CUSTOMER.addressLine, "zz-jeton-de-test"]) {
      expect(text).not.toContain(value);
    }
  });

  it("times out after 10 s by default (ADR 0007)", async () => {
    const { TIMEOUT_MS } = await import("./guard");
    expect(TIMEOUT_MS).toBe(10_000);
  });
});

describe("connectorFor", () => {
  it("refuses the fake tool unless INVOICING_FAKE_ALLOWED=1", () => {
    for (const env of [{}, { INVOICING_FAKE_ALLOWED: "0" }, { INVOICING_FAKE_ALLOWED: "true" }]) {
      expect(() => make({ env })).toThrow(
        expect.objectContaining({ kind: "configuration", code: "fake_not_allowed" }) as Error,
      );
    }
  });

  it("refuses unreadable credentials without echoing them", () => {
    const build = () =>
      connectorFor({ billingEntityId: entityId, tool: "fake", encryptedCredentials: "zz-en-clair" }, FAST);
    expect(build).toThrow(expect.objectContaining({ code: "credentials_unreadable" }) as Error);
    const wrongShape = () =>
      connectorFor(
        { billingEntityId: entityId, tool: "fake", encryptedCredentials: encrypt(JSON.stringify({ cle: 1 })) },
        FAST,
      );
    expect(wrongShape).toThrow(expect.objectContaining({ code: "credentials_shape" }) as Error);
  });

  it("refuses a real tool whose connector does not exist yet", () => {
    for (const tool of ["pennylane", "abby", "shine"] as const) {
      expect(() =>
        connectorFor({ billingEntityId: entityId, tool, encryptedCredentials: credentials() }, FAST),
      ).toThrow(expect.objectContaining({ kind: "unsupported" }) as Error);
    }
  });

  it("keeps each business's documents apart", async () => {
    const first = make();
    const { toolRef } = await draft(first);
    entityId = randomUUID();
    await expect(make().readStatus(toolRef)).rejects.toMatchObject({ kind: "not_found" });
  });

  it("refuses to record a payment while payment e-reporting is off", async () => {
    expect(PAYMENT_E_REPORTING).toBe(false);
    const connector = make();
    expect(connector.capabilities.recordPayment).toBe(false);
    const { toolRef } = await draft(connector);
    await expect(
      connector.recordPayment({
        externalRef: randomUUID(),
        invoiceToolRef: toolRef,
        amountCents: 100,
        paidOn: "2027-09-01",
      }),
    ).rejects.toMatchObject({ kind: "unsupported", code: "payment_e_reporting_off" });
    expect(fakeStoreOf(entityId).calls).not.toContain("recordPayment");
  });

  it("records a payment on an issued invoice once the capability is on", async () => {
    const connector = make({ ...FAST, recordPayment: true });
    expect(connector.capabilities.recordPayment).toBe(true);
    const { toolRef } = await draft(connector);
    await connector.finalize({ toolRef, totalInclTaxCents: 34150 });
    await expect(
      connector.recordPayment({
        externalRef: randomUUID(),
        invoiceToolRef: toolRef,
        amountCents: 100,
        paidOn: "2027-09-01",
      }),
    ).resolves.toBeUndefined();
  });
});
