import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { encrypt } from "../../lib/encryption";
import { FAKE_NUMBER_PREFIX, INVOICING_TOOLS, PAYMENT_E_REPORTING } from "../../domain/billing/invoicing";
import { type CustomerPayload, type InvoicePayload, type InvoicingConnector, InvoicingError } from "./contract";
import { connectorFor, toolAvailable } from "./connector";
import { FAKE_REFUSED_TOKEN, type FakeFault, fakeStoreOf } from "./fake";
import { creditNotePayload, invoicePayload, type StoredLine, totalsOf } from "./payload";
import { guarded } from "./guard";

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
    unitPriceCents: 10000,
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
    unitPriceCents: 4150,
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
    totals: totalsOf(LINES),
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
      totals: totalsOf(LINES),
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

  it("sends the unit price and the line total apart (2 × 50,00 €)", () => {
    const line: StoredLine = {
      ...LINES[3],
      quantityThousandths: 2000,
      unitPriceCents: 5000,
      inclTaxCents: 10000,
      exclTaxCents: 10000,
    };
    const payload = invoicePayload({
      invoiceId: "i",
      customerRef: "c",
      vatMention: null,
      lines: [line],
      totals: totalsOf([line]),
      installments: [],
    });
    expect(payload.lines[0]).toMatchObject({ quantityThousandths: 2000, unitPriceCents: 5000, inclTaxCents: 10000 });
  });

  const build = (over: Partial<Parameters<typeof invoicePayload>[0]>) => () =>
    invoicePayload({
      invoiceId: "i",
      customerRef: "c",
      vatMention: null,
      lines: LINES,
      totals: totalsOf(LINES),
      installments: [],
      ...over,
    });

  it("refuses a line without VAT that lacks its mention", () => {
    expect(build({ lines: [{ ...LINES[3], vatMention: " " }], totals: totalsOf([LINES[3]]) })).toThrow(
      expect.objectContaining({ kind: "format", code: "missing_vat_mention" }) as Error,
    );
  });

  it("refuses stored totals that differ from the lines", () => {
    expect(build({ totals: { inclTaxCents: 34151, exclTaxCents: 29151, vatCents: 5000 } })).toThrow(
      expect.objectContaining({ code: "totals_differ_from_lines" }) as Error,
    );
  });

  it("accepts installments adding up to the total, cents left over included, and refuses others", () => {
    // 341,50 € in 3: 113,84 + 113,83 + 113,83.
    const split = [11384, 11383, 11383].map((amountCents) => ({ dueDate: "2027-10-01", amountCents }));
    expect(build({ installments: split })().installments).toHaveLength(3);
    expect(build({ installments: split.slice(1) })).toThrow(
      expect.objectContaining({ code: "installments_differ_from_total" }) as Error,
    );
  });

  it("builds a credit note of negative lines only", () => {
    const negative = { ...LINES[3], unitPriceCents: -4150, inclTaxCents: -4150, exclTaxCents: -4150 };
    const of = (lines: StoredLine[]) => () =>
      creditNotePayload({
        creditNoteId: "a",
        customerRef: "c",
        vatMention: null,
        totals: totalsOf(lines),
        lines,
        creditedToolRef: "t",
      });
    expect(of([negative])()).toMatchObject({ externalRef: "a", creditedToolRef: "t", totals: { inclTaxCents: -4150 } });
    expect(of([negative])()).not.toHaveProperty("installments");
    for (const lines of [[], [LINES[3]], [negative, LINES[3]]]) {
      expect(of(lines)).toThrow(expect.objectContaining({ code: "credit_note_not_negative" }) as Error);
    }
  });

  it("refuses an amount that is not whole cents", () => {
    expect(build({ lines: [{ ...LINES[3], unitPriceCents: 41.5 }], totals: totalsOf([LINES[3]]) })).toThrow(
      expect.objectContaining({ code: "amount_not_cents" }) as Error,
    );
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
    const credit = invoicePayload({
      ...payload,
      invoiceId: randomUUID(),
      lines: negative,
      totals: totalsOf(negative),
      installments: [],
    });
    const note = await connector.createCreditNote({ ...credit, creditedToolRef: toolRef });
    expect(note).toMatchObject({ status: "issued", totalInclTaxCents: -34150 });
    expect(note.number?.startsWith(FAKE_NUMBER_PREFIX)).toBe(true);
    expect(note.number).not.toBe(issued.number);
    // Nothing more can be credited: the invoice is cancelled in full.
    await expect(
      connector.createCreditNote({ ...credit, externalRef: randomUUID(), creditedToolRef: toolRef }),
    ).rejects.toMatchObject({ kind: "rejected", code: "credit_exceeds_invoice" });
  });

  it("credits part of an invoice, never more than what is left", async () => {
    const connector = make();
    const { payload, toolRef } = await draft(connector);
    await connector.finalize({ toolRef, totalInclTaxCents: 34150 });
    const part = (inclTaxCents: number): StoredLine => ({
      ...LINES[3],
      unitPriceCents: inclTaxCents,
      inclTaxCents,
      exclTaxCents: inclTaxCents,
    });
    const creditOf = (lines: StoredLine[]) => ({
      ...invoicePayload({ ...payload, invoiceId: randomUUID(), lines, totals: totalsOf(lines), installments: [] }),
      creditedToolRef: toolRef,
    });
    await expect(connector.createCreditNote(creditOf([part(-30000)]))).resolves.toMatchObject({
      totalInclTaxCents: -30000,
    });
    await expect(connector.createCreditNote(creditOf([part(-4151)]))).rejects.toMatchObject({
      code: "credit_exceeds_invoice",
    });
    await expect(connector.createCreditNote(creditOf([part(-4150)]))).resolves.toMatchObject({ status: "issued" });
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
      totals: totalsOf(LINES),
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

  it("rejects a credit note whose total differs from ours, handing it back", async () => {
    const connector = make();
    const { payload, toolRef } = await draft(connector);
    await connector.finalize({ toolRef, totalInclTaxCents: 34150 });
    const lines = [{ ...LINES[3], unitPriceCents: -4150, inclTaxCents: -4150, exclTaxCents: -4150 }];
    const credit = invoicePayload({
      ...payload,
      invoiceId: randomUUID(),
      lines,
      totals: totalsOf(lines),
      installments: [],
    });
    inject({ kind: "total_offset", cents: 1 });
    const error = await connector.createCreditNote({ ...credit, creditedToolRef: toolRef }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "rejected", code: "total_mismatch", operation: "createCreditNote" });
    expect(error).toHaveProperty("document.status", "issued");
  });

  it("rejects an issued invoice whose total differs from ours, handing back what the tool issued", async () => {
    const connector = make();
    const { toolRef } = await draft(connector);
    inject({ kind: "total_offset", cents: -1 });
    const error = await connector.finalize({ toolRef, totalInclTaxCents: 34150 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "rejected", code: "total_mismatch" });
    // Numbered in the tool already: the caller records it, then corrects it with a credit note.
    expect(error).toHaveProperty("document.toolRef", toolRef);
    expect(error).toHaveProperty("document.status", "issued");
    expect(error).toHaveProperty("document.totalInclTaxCents", 34149);
    expect((error as InvoicingError).document?.number?.startsWith(FAKE_NUMBER_PREFIX)).toBe(true);
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
      totals: totalsOf(LINES),
      installments: [],
    });
    // Created in the tool, the answer lost: the retry gets the first document back.
    inject({ kind: "lost_response" });
    const doc = await connector.createInvoice(payload);
    expect(fakeStoreOf(entityId).calls.filter((c) => c === "createInvoice")).toHaveLength(2);
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

  it("gives up on time even with a client that ignores its signal", async () => {
    const never = () => new Promise<never>(() => undefined);
    const connector = guarded(
      {
        tool: "fake",
        supportsRecordPayment: false,
        checkCredentials: never,
        createCustomer: never,
        createInvoice: never,
        finalize: never,
        createCreditNote: never,
        readStatus: never,
        recordPayment: never,
      },
      { capabilities: { recordPayment: false }, timeoutMs: 20, pauseMs: 1 },
    );
    await expect(connector.readStatus("zz")).rejects.toMatchObject({ kind: "timeout", operation: "readStatus" });
  });

  it("keeps only plain technical codes, never a tool's free text", () => {
    expect(new InvoicingError("rejected", "createCustomer", "Zzmartin Zoé déjà connu").code).toBe("unrecognised");
    expect(new InvoicingError("rejected", "createCustomer", "status_422").code).toBe("status_422");
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

  it("tells a missing encryption key apart from wrong credentials", () => {
    const encrypted = credentials();
    delete process.env.CLE_CHIFFREMENT;
    expect(() =>
      connectorFor({ billingEntityId: entityId, tool: "fake", encryptedCredentials: encrypted }, FAST),
    ).toThrow(expect.objectContaining({ kind: "configuration", code: "encryption_key_missing" }) as Error);
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

describe("toolAvailable", () => {
  it("offers the fake tool only where INVOICING_FAKE_ALLOWED=1, and no real tool yet", () => {
    expect(toolAvailable("fake", { INVOICING_FAKE_ALLOWED: "1" })).toBe(true);
    expect(toolAvailable("fake", {})).toBe(false);
    expect(toolAvailable("fake", { INVOICING_FAKE_ALLOWED: "true" })).toBe(false);
    for (const tool of ["pennylane", "abby", "shine"] as const)
      expect(toolAvailable(tool, { INVOICING_FAKE_ALLOWED: "1" })).toBe(false);
  });

  it("agrees with connectorFor for every tool, valid credentials given", () => {
    const encryptedCredentials = credentials();
    for (const tool of INVOICING_TOOLS)
      for (const env of [{ INVOICING_FAKE_ALLOWED: "1" }, {}]) {
        let built = true;
        try {
          connectorFor({ billingEntityId: entityId, tool, encryptedCredentials }, { ...FAST, env });
        } catch {
          built = false;
        }
        expect(toolAvailable(tool, env)).toBe(built);
      }
  });
});
