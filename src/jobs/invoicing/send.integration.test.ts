import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type FakeFault, fakeStoreOf } from "../../connectors/invoicing/fake";
import { withSchool } from "../../db";
import { defaultEntityFor, treatmentFor } from "../../db/billing-entity.integration-helpers";
import { claimDue, dueWork, recordFailure, sendingProblemCount, sendingProblems } from "../../db/invoice-outbox";
import { MAX_ATTEMPTS } from "../../domain/invoicing/outbox";
import { encrypt } from "../../lib/encryption";
import { type RunOptions, sendEntityInvoices, sweep } from "./send";

/**
 * Invoice outbox (#304) against the real database, run as the application (app_user, RLS),
 * through the fake invoicing tool only (never a real tool). Fictitious data, deleted at the
 * end with the immutability triggers disabled inside an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });
// CI has no encryption key: a throwaway one encrypts the fake tool's test token.
if (Buffer.from(process.env.CLE_CHIFFREMENT ?? "", "base64").length !== 32)
  process.env.CLE_CHIFFREMENT = randomBytes(32).toString("base64");

const RUN: RunOptions = { env: { INVOICING_FAKE_ALLOWED: "1" }, pauseMs: 0, timeoutMs: 2000 };
const suffix = Math.random().toString(36).slice(2, 8);
const ids = {} as Record<"school" | "other" | "a" | "b" | "otherEntity" | "payer" | "otherPayer" | "exempt", string>;

const TRIGGERS = [
  ["invoice", "invoice_issued_immutable"],
  ["invoice_line", "invoice_line_immutable"],
  ["installment", "installment_immutable"],
  ["audit_log", "audit_log_append_only"],
];

async function clearInvoices() {
  await admin.begin(async (t) => {
    for (const [table, trigger] of TRIGGERS) await t.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
    for (const table of ["invoice_line", "installment", "invoice", "audit_log"])
      await t.unsafe(`DELETE FROM ${table} WHERE school_id IN ($1, $2)`, [ids.school, ids.other]);
    for (const [table, trigger] of TRIGGERS) await t.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
  });
}

beforeAll(async () => {
  [{ id: ids.school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École envoi', ${`env-a-${suffix}`}) RETURNING id`;
  [{ id: ids.other }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École autre', ${`env-b-${suffix}`}) RETURNING id`;
  ids.a = await defaultEntityFor(admin, ids.school, "Zz Danse A");
  ids.exempt = await treatmentFor(admin, ids.school);
  [{ id: ids.b }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, default_vat_treatment_id)
    VALUES (${ids.school}, 'Zz Danse B', 'Zz Danse B', 'not_applicable', ${ids.exempt}) RETURNING id`;
  ids.otherEntity = await defaultEntityFor(admin, ids.other, "Zz Danse T");
  const credentials = encrypt(JSON.stringify({ token: "zz-jeton" }));
  for (const [school, entity] of [
    [ids.school, ids.a],
    [ids.school, ids.b],
    [ids.other, ids.otherEntity],
  ])
    await admin`INSERT INTO invoicing_connector (school_id, billing_entity_id, tool, encrypted_credentials)
      VALUES (${school}, ${entity}, 'fake', ${credentials})`;
  [{ id: ids.payer }] = await admin`INSERT INTO person (school_id, last_name, first_name)
    VALUES (${ids.school}, 'Zzpayeur', 'Zoé') RETURNING id`;
  [{ id: ids.otherPayer }] = await admin`INSERT INTO person (school_id, last_name, first_name)
    VALUES (${ids.other}, 'Zzautre', 'Zia') RETURNING id`;
});

afterAll(async () => {
  await clearInvoices();
  await admin`DELETE FROM invoicing_connector WHERE school_id IN (${ids.school}, ${ids.other})`;
  await admin`DELETE FROM person WHERE school_id IN (${ids.school}, ${ids.other})`;
  await admin`DELETE FROM school WHERE id IN (${ids.school}, ${ids.other})`;
  await admin.end();
});

beforeEach(async () => {
  await clearInvoices();
  for (const entity of [ids.a, ids.b, ids.otherEntity]) {
    const store = fakeStoreOf(entity);
    store.faults.length = 0;
    store.calls.length = 0;
    store.documents.clear();
    store.byExternalRef.clear();
  }
});

/** A due invoice of `entity`: one exempt line, its installments adding up to its total unless told otherwise. */
async function newInvoice(
  entity: string,
  o: { installments?: number[]; status?: string; toolRef?: string; attempts?: number; school?: string } = {},
): Promise<string> {
  const school = o.school ?? ids.school;
  const payer = school === ids.school ? ids.payer : ids.otherPayer;
  const treatment = school === ids.school ? ids.exempt : await treatmentFor(admin, school);
  const total = 12000;
  const [{ id }] = await admin`
    INSERT INTO invoice (school_id, billing_entity_id, payer_id, status, tool, tool_ref, attempts,
      total_incl_tax_cents, total_excl_tax_cents, total_vat_cents, next_attempt_at)
    VALUES (${school}, ${entity}, ${payer}, ${o.status ?? "to_send"}, ${o.toolRef ? "fake" : null},
      ${o.toolRef ?? null}, ${o.attempts ?? 0}, ${total}, ${total}, 0, now() - interval '1 second')
    RETURNING id`;
  await admin`INSERT INTO invoice_line (school_id, billing_entity_id, invoice_id, label, unit_price_cents,
      incl_tax_cents, excl_tax_cents, vat_cents, vat_treatment_id, vat_category, vat_mention)
    VALUES (${school}, ${entity}, ${id}, 'Zz cours', ${total}, ${total}, ${total}, 0, ${treatment}, 'exempt', 'Zz mention')`;
  for (const [i, amount] of (o.installments ?? [6000, 6000]).entries())
    await admin`INSERT INTO installment (school_id, billing_entity_id, invoice_id, rank, due_date, amount_cents)
      VALUES (${school}, ${entity}, ${id}, ${i + 1}, ${`2027-1${i}-01`}, ${amount})`;
  return id;
}

const row = async (id: string) =>
  (
    await admin`SELECT status, tool, tool_ref, number, issued_on::text AS issued_on, attempts, claimed_until,
      send_error_kind, send_error_code, tool_total_incl_tax_cents AS tool_total, round(extract(epoch FROM next_attempt_at - now()) / 60) AS wait_minutes
      FROM invoice WHERE id = ${id}`
  )[0];

const faults = (entity: string, ...list: FakeFault[]) => fakeStoreOf(entity).faults.push(...list);
const noFault: FakeFault = { kind: "total_offset", cents: 0 };

describe("invoicing_due_work()", () => {
  it("returns only the (school, business) pairs with an invoice due through an active connector", async () => {
    await newInvoice(ids.a);
    await newInvoice(ids.otherEntity, { school: ids.other });
    // Not due: held for later, claimed by a run, already issued elsewhere: none adds a pair.
    const later = await newInvoice(ids.b);
    await admin`UPDATE invoice SET next_attempt_at = now() + interval '1 hour' WHERE id = ${later}`;
    const claimed = await newInvoice(ids.b);
    await admin`UPDATE invoice SET claimed_until = now() + interval '5 minutes' WHERE id = ${claimed}`;
    const rejected = await newInvoice(ids.b);
    await admin`UPDATE invoice SET status = 'rejected' WHERE id = ${rejected}`;
    const creditNote = await newInvoice(ids.b);
    await admin`UPDATE invoice SET credit_note_of = ${rejected} WHERE id = ${creditNote}`;
    const mine = (await dueWork()).filter((w) => [ids.school, ids.other].includes(w.schoolId));
    expect(mine).toEqual(
      expect.arrayContaining([
        { schoolId: ids.school, billingEntityId: ids.a },
        { schoolId: ids.other, billingEntityId: ids.otherEntity },
      ]),
    );
    expect(mine).toHaveLength(2);
    await admin`UPDATE invoicing_connector SET active = false WHERE billing_entity_id = ${ids.a}`;
    try {
      expect((await dueWork()).some((w) => w.billingEntityId === ids.a)).toBe(false);
    } finally {
      await admin`UPDATE invoicing_connector SET active = true WHERE billing_entity_id = ${ids.a}`;
    }
  });

  it("gives the application ids only, while its own reads stay under RLS", async () => {
    await newInvoice(ids.a);
    const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      const rows = await app`SELECT * FROM invoicing_due_work()`;
      expect(rows.columns.map((c) => c.name)).toEqual(["school_id", "billing_entity_id"]);
      expect(rows.some((r) => r.billing_entity_id === ids.a)).toBe(true);
      // Without a school, the application itself still sees no invoice.
      expect(await app`SELECT id FROM invoice`).toHaveLength(0);
    } finally {
      await app.end();
    }
  });

  it("is SECURITY DEFINER with an empty search_path, owned by a role bypassing RLS, not executable by PUBLIC", async () => {
    const [f] = await admin`
      SELECT p.prosecdef, p.proconfig, p.proacl::text[] AS acl, r.rolsuper OR r.rolbypassrls AS bypass
      FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = 'invoicing_due_work'`;
    expect(f.prosecdef).toBe(true);
    expect(f.proconfig).toEqual(['search_path=""']);
    expect(f.bypass).toBe(true);
    expect((f.acl as string[]).some((entry) => entry.startsWith("="))).toBe(false);
    expect((f.acl as string[]).some((entry) => entry.startsWith("app_user=X"))).toBe(true);
  });
});

describe("sending through the fake tool", () => {
  it("issues a draft: the tool's « TEST- » number, its date and the tool copied onto the invoice", async () => {
    const id = await newInvoice(ids.a);
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ claimed: 1, issued: 1 });
    const r = await row(id);
    expect(r).toMatchObject({
      status: "issued",
      tool: "fake",
      attempts: 1,
      claimed_until: null,
      send_error_code: null,
    });
    expect(r.number).toMatch(/^TEST-F-/);
    expect(r.issued_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [log] = await admin`SELECT actor, after FROM audit_log WHERE row_id = ${id}`;
    expect(log).toMatchObject({ actor: null, after: { status: "issued", number: r.number } });
  });

  it("two concurrent runs never send the same invoice twice", async () => {
    const created = await Promise.all([1, 2, 3, 4, 5, 6].map(() => newInvoice(ids.a)));
    const [one, two] = await Promise.all([
      sendEntityInvoices(ids.school, ids.a, RUN),
      sendEntityInvoices(ids.school, ids.a, RUN),
    ]);
    expect(one.claimed + two.claimed).toBe(6);
    expect(one.issued + two.issued).toBe(6);
    const calls = fakeStoreOf(ids.a).calls;
    expect(calls.filter((c) => c === "createInvoice")).toHaveLength(6);
    expect(calls.filter((c) => c === "finalize")).toHaveLength(6);
    for (const id of created) expect(await row(id)).toMatchObject({ status: "issued", attempts: 1 });
  });

  it("a failing business does not block the other business's invoices", async () => {
    const a = await newInvoice(ids.a);
    const b = await newInvoice(ids.b);
    // Business B's tool answers 503 to everything (each call and its quick retry).
    faults(ids.b, ...Array.from({ length: 20 }, (): FakeFault => ({ kind: "server" })));
    const report = await sweep({ ...RUN, schoolId: ids.school });
    expect(report).toMatchObject({ pairs: 2, issued: 1, retried: 1, failedPairs: 0 });
    expect(await row(a)).toMatchObject({ status: "issued" });
    expect(await row(b)).toMatchObject({
      status: "to_send",
      attempts: 1,
      send_error_kind: "server",
      wait_minutes: "1",
    });
  });

  it("the sweep of one school's run never touches another school's invoices", async () => {
    const theirs = await newInvoice(ids.otherEntity, { school: ids.other });
    await sweep({ ...RUN, schoolId: ids.school });
    expect(await row(theirs)).toMatchObject({ status: "to_send", attempts: 0 });
  });

  it("a business of another school is out of reach: its connector is read under RLS", async () => {
    const mine = await newInvoice(ids.a);
    expect(await sendEntityInvoices(ids.other, ids.a, RUN)).toMatchObject({
      claimed: 0,
      skipped: "no_active_connector",
    });
    expect(await row(mine)).toMatchObject({ status: "to_send", attempts: 0 });
  });

  it("backs off 1 min, 5 min, 30 min… and rejects at the 10th attempt, shown to management", async () => {
    const id = await newInvoice(ids.a, { attempts: 2 });
    faults(ids.a, { kind: "network" }, { kind: "network" });
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ retried: 1 });
    expect(await row(id)).toMatchObject({
      status: "to_send",
      attempts: 3,
      send_error_kind: "network",
      wait_minutes: "30",
    });

    await admin`UPDATE invoice SET attempts = ${MAX_ATTEMPTS - 1}, next_attempt_at = now() WHERE id = ${id}`;
    faults(ids.a, { kind: "server" }, { kind: "server" });
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ rejected: 1 });
    expect(await row(id)).toMatchObject({ status: "rejected", attempts: MAX_ATTEMPTS, claimed_until: null });
    const problems = await withSchool(ids.school, sendingProblems);
    expect(problems).toEqual([
      expect.objectContaining({ id, status: "rejected", sendErrorKind: "server", linesGivenBack: true }),
    ]);
    // Rejected for good: no later run takes it again.
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ claimed: 0 });
  });

  it("rejects at once an invoice the tool refuses", async () => {
    const id = await newInvoice(ids.a);
    faults(ids.a, noFault, { kind: "rejected" });
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ rejected: 1 });
    expect(await row(id)).toMatchObject({
      status: "rejected",
      attempts: 1,
      send_error_kind: "rejected",
      tool_ref: null,
    });
  });

  it("records an invoice the tool issued with another total, flagged for a credit note", async () => {
    const id = await newInvoice(ids.a);
    faults(ids.a, noFault, noFault, { kind: "total_offset", cents: 1 });
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ issued: 1 });
    const r = await row(id);
    expect(r).toMatchObject({ status: "issued", send_error_code: "total_mismatch", tool_total: 12001 });
    expect(r.number).toMatch(/^TEST-F-/);
    const problems = await withSchool(ids.school, sendingProblems);
    expect(problems).toEqual([expect.objectContaining({ id, status: "issued", number: r.number })]);
  });

  it("creates the draft again when the tool lost it (the fake's memory after a restart)", async () => {
    const id = await newInvoice(ids.a, { status: "tool_draft", toolRef: "fake_invoice_zz-lost", attempts: 1 });
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ issued: 1 });
    expect(await row(id)).toMatchObject({ status: "issued", attempts: 2 });
  });

  it("records the issue a lost answer hid, without issuing twice", async () => {
    const id = await newInvoice(ids.a);
    // The tool issues, then its answer is lost (twice: the call and its quick retry).
    faults(ids.a, noFault, noFault, { kind: "lost_response" }, { kind: "lost_response" });
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ retried: 1 });
    expect(await row(id)).toMatchObject({ status: "tool_draft", attempts: 1 });
    await admin`UPDATE invoice SET next_attempt_at = now() WHERE id = ${id}`;
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ issued: 1 });
    expect(await row(id)).toMatchObject({ status: "issued", attempts: 2 });
    expect(fakeStoreOf(ids.a).documents.size).toBe(1);
  });

  it("holds a draft whose installments do not cover it (#176): never claimed nor counted", async () => {
    const id = await newInvoice(ids.a, { installments: [] });
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ claimed: 0 });
    expect(await row(id)).toMatchObject({ status: "to_send", attempts: 0 });
  });

  it("leaves the invoices waiting, uncounted, where the fake tool is not allowed", async () => {
    const id = await newInvoice(ids.a);
    expect(await sendEntityInvoices(ids.school, ids.a, { ...RUN, env: {} })).toMatchObject({
      claimed: 0,
      skipped: "fake_not_allowed",
    });
    expect(await row(id)).toMatchObject({ status: "to_send", attempts: 0 });
  });

  it("flags a total difference found after a lost answer, when the tool's status shows it issued", async () => {
    const id = await newInvoice(ids.a);
    // The tool issues, its answer is lost (the call and its retry); next run reads another total.
    faults(ids.a, noFault, noFault, { kind: "lost_response" }, { kind: "lost_response" });
    await sendEntityInvoices(ids.school, ids.a, RUN);
    await admin`UPDATE invoice SET next_attempt_at = now() WHERE id = ${id}`;
    faults(ids.a, { kind: "total_offset", cents: -1 });
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ issued: 1 });
    expect(await row(id)).toMatchObject({ status: "issued", send_error_code: "total_mismatch", tool_total: 11999 });
    expect(await withSchool(ids.school, sendingProblemCount)).toBe(1);
  });

  /** An invoice left in the tool as a draft: finalize answered 503 twice. */
  async function toolDraft(): Promise<{ id: string; toolRef: string }> {
    const id = await newInvoice(ids.a);
    faults(ids.a, noFault, noFault, { kind: "server" }, { kind: "server" });
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ retried: 1 });
    await admin`UPDATE invoice SET next_attempt_at = now() WHERE id = ${id}`;
    const r = await row(id);
    expect(r).toMatchObject({ status: "tool_draft" });
    return { id, toolRef: r.tool_ref };
  }

  it("records a draft the tool cancelled: its lines are given back", async () => {
    const { id, toolRef } = await toolDraft();
    fakeStoreOf(ids.a).documents.get(toolRef)!.status = "cancelled"; // set by toolDraft() just above
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ cancelled: 1 });
    expect(await row(id)).toMatchObject({ status: "cancelled", claimed_until: null });
    const [log] = await admin`SELECT after FROM audit_log WHERE row_id = ${id}`;
    expect(log.after).toEqual({ status: "cancelled" });
  });

  it("rejects a draft the tool rejected, keeping its tool reference (its lines stay billed)", async () => {
    const { id, toolRef } = await toolDraft();
    fakeStoreOf(ids.a).documents.get(toolRef)!.status = "rejected"; // set by toolDraft() just above
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ rejected: 1 });
    expect(await row(id)).toMatchObject({ status: "rejected", tool_ref: toolRef });
    const [problem] = await withSchool(ids.school, sendingProblems);
    expect(problem).toMatchObject({ id, linesGivenBack: false });
  });

  it("keeps the tool's draft reference when the tool's draft total differs from ours", async () => {
    const id = await newInvoice(ids.a);
    faults(ids.a, noFault, { kind: "total_offset", cents: 5 });
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ rejected: 1 });
    const r = await row(id);
    expect(r).toMatchObject({ status: "rejected", send_error_code: "total_mismatch", tool: "fake" });
    expect(r.tool_ref).toMatch(/^fake_invoice_/);
  });

  it("a run whose claim ran out records nothing once another run took the invoice over", async () => {
    const id = await newInvoice(ids.a);
    const [stale] = await withSchool(ids.school, (tx) => claimDue(tx, ids.a, 1));
    expect(stale).toMatchObject({ id, attempts: 1 });
    // Its claim runs out: the next run takes the invoice and issues it.
    await admin`UPDATE invoice SET claimed_until = now() - interval '1 second' WHERE id = ${id}`;
    expect(await sendEntityInvoices(ids.school, ids.a, RUN)).toMatchObject({ claimed: 1, issued: 1 });
    // The first run comes back with a failure: nothing is written.
    const wrote = await withSchool(ids.school, (tx) => recordFailure(tx, stale, { kind: "server", code: null }, 1));
    expect(wrote).toBe(false);
    expect(await row(id)).toMatchObject({ status: "issued", send_error_kind: null });
  });

  it("an expired claim taken over by another run is no longer the first run's to write", async () => {
    const id = await newInvoice(ids.a);
    const [stale] = await withSchool(ids.school, (tx) => claimDue(tx, ids.a, 1));
    await admin`UPDATE invoice SET claimed_until = now() - interval '1 second' WHERE id = ${id}`;
    const [taken] = await withSchool(ids.school, (tx) => claimDue(tx, ids.a, 1));
    expect(taken).toMatchObject({ id, attempts: 2 });
    // Still `to_send`: only the claim tells the two runs apart.
    const wrote = await withSchool(ids.school, (tx) => recordFailure(tx, stale, { kind: "server", code: null }, 1));
    expect(wrote).toBe(false);
    expect(await row(id)).toMatchObject({ status: "to_send", attempts: 2, send_error_kind: null });
    expect(await withSchool(ids.school, (tx) => recordFailure(tx, taken, { kind: "server", code: null }, 1))).toBe(
      true,
    );
  });

  it("a backlog of drafts held for their due dates never keeps a sendable one from going", async () => {
    for (let i = 0; i < 30; i++) await newInvoice(ids.a, { installments: [] });
    // Older than the sendable draft: first in the order of due attempts.
    await admin`UPDATE invoice SET next_attempt_at = now() - interval '1 day' WHERE billing_entity_id = ${ids.a}`;
    const sendable = await newInvoice(ids.a);
    expect(await sendEntityInvoices(ids.school, ids.a, { ...RUN, batchSize: 5 })).toMatchObject({
      claimed: 1,
      issued: 1,
    });
    expect(await row(sendable)).toMatchObject({ status: "issued" });
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM invoice
      WHERE billing_entity_id = ${ids.a} AND status = 'to_send' AND attempts = 0`;
    expect(n).toBe(30);
  });
});
