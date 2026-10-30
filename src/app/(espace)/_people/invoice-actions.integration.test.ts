import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { schoolWithDefaultEntity, treatmentFor } from "../../../db/billing-entity.integration-helpers";

/**
 * Drafting a payer's invoices from their record, and taking up a rejected one (#352): the server
 * actions against the real database (app_user, RLS), the session stubbed and `after()` collected
 * so the test runs the sending itself, through the fake invoicing tool only. Fictitious data
 * deleted at the end, the immutability triggers disabled inside an administration transaction.
 */

type Role = "director" | "front_desk" | "teacher";
const session = vi.hoisted(() => ({ schoolId: "", userId: "", role: "director" as Role }));
const pending = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("@/lib/session", () => ({
  requireRole: async (...roles: Role[]) => {
    // As requireRole: another role is sent away (redirect) before anything is read.
    if (!roles.includes(session.role)) throw new Error("NEXT_REDIRECT /");
    return { schoolId: session.schoolId, userId: session.userId, role: session.role };
  },
}));
// `after()` runs its callback once the answer is gone: collected here, run by the test.
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => pending.push(fn) }));
// Vitest has no `@/` alias: the real modules, by relative path.
vi.mock("@/db", () => import("../../../db/index"));
vi.mock("@/db/payer-invoices", () => import("../../../db/payer-invoices"));
vi.mock("@/domain/invoicing/progress", () => import("../../../domain/invoicing/progress"));
vi.mock("@/jobs/invoicing/send", () => import("../../../jobs/invoicing/send"));

process.env.INVOICING_FAKE_ALLOWED = "1";
// CI has no encryption key: a throwaway one encrypts the fake tool's test token.
if (Buffer.from(process.env.CLE_CHIFFREMENT ?? "", "base64").length !== 32)
  process.env.CLE_CHIFFREMENT = randomBytes(32).toString("base64");

const { draftInvoices } = await import("./invoice-actions");
const { abandon, sendAgain } = await import("../parametres/entreprises/actions");
const { withSchool } = await import("../../../db/index");
const { payerInvoices } = await import("../../../db/payer-invoices");
const { encrypt } = await import("../../../lib/encryption");
const { fakeStoreOf } = await import("../../../connectors/invoicing/fake");

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const users = {
  director: `zz-fac-dir-${suffix}`,
  front_desk: `zz-fac-acc-${suffix}`,
  teacher: `zz-fac-prof-${suffix}`,
};
const ids = {} as Record<string, string>;

const TRIGGERS = [
  ["invoice", "invoice_issued_immutable"],
  ["invoice_line", "invoice_line_immutable"],
  ["installment", "installment_immutable"],
  ["audit_log", "audit_log_append_only"],
  ["payment", "payment_immutable"],
];

async function clearInvoices() {
  await admin.begin(async (t) => {
    for (const [table, trigger] of TRIGGERS) await t.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
    for (const table of ["payment_allocation", "invoice_line", "installment", "invoice", "audit_log", "payment"])
      await t.unsafe(`DELETE FROM ${table} WHERE school_id IN ($1, $2)`, [ids.school, ids.other]);
    for (const [table, trigger] of TRIGGERS) await t.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
  });
}

beforeAll(async () => {
  [{ id: ids.school }] = await schoolWithDefaultEntity(admin, "Zz École factures fiche", `zzff-${suffix}`);
  [{ id: ids.other }] = await schoolWithDefaultEntity(admin, "Zz École voisine", `zzfv-${suffix}`);
  const s = ids.school;
  for (const [role, user] of Object.entries(users)) {
    await admin`INSERT INTO "user" (id, name, email) VALUES (${user}, 'Zzfaux Test', ${`${user}@exemple.test`})`;
    await admin`INSERT INTO member (school_id, user_id, role) VALUES (${s}, ${user}, ${role})`;
  }
  [{ id: ids.a, default_vat_treatment_id: ids.exempt }] =
    await admin`SELECT id, default_vat_treatment_id FROM billing_entity WHERE school_id = ${s} AND is_default`;
  ids.vat20 = await treatmentFor(admin, s, 2000);
  [{ id: ids.b }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, default_vat_treatment_id)
    VALUES (${s}, 'Zz Entreprise B', 'Zz Entreprise B', 'vat_registered', ${ids.vat20}) RETURNING id`;
  const credentials = encrypt(JSON.stringify({ token: "zz-jeton" }));
  for (const entity of [ids.a, ids.b])
    await admin`INSERT INTO invoicing_connector (school_id, billing_entity_id, tool, encrypted_credentials)
      VALUES (${s}, ${entity}, 'fake', ${credentials})`;
  [{ id: ids.season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${s}, '2027-2028', '2027-09-01', '2028-06-30') RETURNING id`;
  for (const [key, start, end] of [
    ["q1", "2027-10-01", "2027-12-31"],
    ["q2", "2028-01-01", "2028-03-31"],
    ["q3", "2028-04-01", "2028-06-30"],
  ])
    [{ id: ids[key] }] = await admin`INSERT INTO season_quarter (school_id, season_id, label, start_date, end_date)
      VALUES (${s}, ${ids.season}, ${`Zz ${key}`}, ${start}, ${end}) RETURNING id`;
  [{ id: ids.jazz }] = await admin`INSERT INTO discipline (school_id, name) VALUES (${s}, 'Zz Jazz') RETURNING id`;
  const [site] = await admin`INSERT INTO site (school_id, name, address) VALUES (${s}, 'Zz Site', 'Zz') RETURNING id`;
  [{ id: ids.room }] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${s}, ${site.id}, 'Zz Salle') RETURNING id`;
  [{ id: ids.teacher }] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${s}, 'Zzprof', 'Zz', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  for (const [key, entity, treatment] of [
    ["courseA", ids.a, ids.exempt],
    ["courseB", ids.b, ids.vat20],
  ])
    [{ id: ids[key] }] = await admin`
      INSERT INTO course (school_id, season_id, billing_entity_id, vat_treatment_id, discipline_id, room_id, instructor_id,
        weekday, start_time, duration_minutes)
      VALUES (${s}, ${ids.season}, ${entity}, ${treatment}, ${ids.jazz}, ${ids.room}, ${ids.teacher}, 3, '17:00', 60)
      RETURNING id`;
  [{ id: ids.payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${s}, 'Zzfamille', 'Zzparent') RETURNING id`;
  [{ id: ids.student }] = await admin`INSERT INTO person (school_id, last_name, first_name, is_student)
    VALUES (${s}, 'Zzfamille', 'Zzalice', true) RETURNING id`;
  // A yearly enrollment of business A (no installment yet, #176: held), a quarterly one of business B (sent).
  [{ id: ids.yearly }] = await admin`
    INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, enrolled_on, gross_price_cents)
    VALUES (${s}, ${ids.a}, ${ids.season}, ${ids.payer}, 'child', 'year', '2027-09-10', 40000) RETURNING id`;
  [{ id: ids.quarterly }] = await admin`
    INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, enrolled_on, gross_price_cents)
    VALUES (${s}, ${ids.b}, ${ids.season}, ${ids.payer}, 'child', 'quarter', '2027-09-15', 12000) RETURNING id`;
  await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id) VALUES
    (${s}, ${ids.a}, ${ids.yearly}, ${ids.student}, ${ids.courseA}),
    (${s}, ${ids.b}, ${ids.quarterly}, ${ids.student}, ${ids.courseB})`;
  await admin`INSERT INTO enrollment_quarter (school_id, enrollment_id, quarter_id) VALUES
    (${s}, ${ids.quarterly}, ${ids.q1}), (${s}, ${ids.quarterly}, ${ids.q2}), (${s}, ${ids.quarterly}, ${ids.q3})`;
  [{ id: ids.otherPayer }] = await admin`INSERT INTO person (school_id, last_name, first_name)
    VALUES (${ids.other}, 'Zzvoisin', 'Zz') RETURNING id`;
});

afterAll(async () => {
  await clearInvoices();
  const s = ids.school;
  for (const t of [
    "enrollment_quarter",
    "enrollment_course",
    "enrollment",
    "invoicing_connector",
    "course",
    "season_quarter",
    "person",
    "instructor",
    "discipline",
    "room",
    "site",
    "season",
    "member",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [s, ids.other]);
  for (const user of Object.values(users)) await admin`DELETE FROM "user" WHERE id = ${user}`;
  await admin`DELETE FROM school WHERE id IN (${s}, ${ids.other})`;
  await admin.end();
});

beforeEach(() => {
  session.schoolId = ids.school;
  session.userId = users.front_desk;
  session.role = "front_desk";
  pending.length = 0;
});

const as = (role: Role) => {
  session.role = role;
  session.userId = users[role];
};
const runAfter = async () => {
  for (const fn of pending.splice(0)) await fn();
};
const invoices = () =>
  admin`SELECT id, billing_entity_id, status, number, attempts, tool_ref, send_error_kind, next_attempt_at <= now() AS due
    FROM invoice WHERE school_id = ${ids.school} ORDER BY created_at, id`;
const live = async (entity: string) =>
  (await invoices()).filter((i) => i.billing_entity_id === entity && i.status !== "cancelled");
/** How many invoices still billing their lines bill the enrollment (never two). */
const billing = async (enrollmentId: string) =>
  (
    await admin`SELECT count(DISTINCT i.id)::int AS n FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id
      WHERE l.enrollment_id = ${enrollmentId}
        AND i.status <> 'cancelled' AND NOT (i.status = 'rejected' AND i.tool_ref IS NULL)`
  )[0].n;
const draft = () => draftInvoices({ payerId: ids.payer, seasonId: ids.season });

describe("draftInvoices (#352)", () => {
  beforeAll(clearInvoices);

  it("refuses a teacher, and a tampered entry without touching the database", async () => {
    as("teacher");
    await expect(draft()).rejects.toThrow("NEXT_REDIRECT");
    as("front_desk");
    expect(await draftInvoices({ payerId: "x", seasonId: ids.season })).toEqual({
      ok: false,
      message: "Factures non préparées : rechargez la fiche.",
    });
    expect(await invoices()).toHaveLength(0);
    expect(pending).toHaveLength(0);
  });

  it("drafts one invoice per business, then wakes the sending once committed", async () => {
    expect(await draft()).toEqual({ ok: true, drafted: 2 });
    // Nothing sent before the answer: both are unsent drafts, the sending is queued.
    expect((await invoices()).map((i) => [i.status, i.attempts])).toEqual([
      ["to_send", 0],
      ["to_send", 0],
    ]);
    expect(pending).toHaveLength(1);
    await runAfter();
    // B's installments cover its total: issued by the fake tool. A's yearly package has none yet (#176): held.
    const [b] = await live(ids.b);
    expect(b).toMatchObject({ status: "issued", number: expect.stringMatching(/^TEST-/) });
    const [a] = await live(ids.a);
    expect(a).toMatchObject({ status: "to_send", attempts: 0, number: null });
  });

  it("shows the payer's invoices with their lines and installments, signed in the audit log", async () => {
    const list = await withSchool(ids.school, (tx) => payerInvoices(tx, ids.payer, ids.season));
    expect(list.map((i) => [i.billingEntityId, i.status, i.connectorTool])).toEqual([
      [ids.a, "to_send", "fake"],
      [ids.b, "issued", "fake"],
    ]);
    expect(list[0].installments).toEqual([]);
    expect(list[1].installments.map((d) => d.amountCents)).toEqual([12000, 12000, 12000]);
    expect(list[1].lines.reduce((sum, l) => sum + l.inclTaxCents, 0)).toBe(list[1].totalInclTaxCents);
    // Another school's payer: nothing (RLS).
    expect(await withSchool(ids.school, (tx) => payerInvoices(tx, ids.otherPayer, ids.season))).toEqual([]);
    const [{ actor }] = await admin`SELECT actor FROM audit_log WHERE school_id = ${ids.school}
      AND target_table = 'invoice' AND action = 'insert' LIMIT 1`;
    const [{ id: member }] = await admin`SELECT id FROM member WHERE user_id = ${users.front_desk}`;
    expect(actor).toBe(member);
  });

  it("drafts again in place: the held draft replaced, the issued one untouched, nothing billed twice", async () => {
    const [before] = await live(ids.a);
    expect(await draft()).toEqual({ ok: true, drafted: 1 });
    expect(await draft()).toEqual({ ok: true, drafted: 1 });
    const a = await live(ids.a);
    expect(a).toHaveLength(1);
    expect(a[0].id).not.toBe(before.id);
    expect(await live(ids.b)).toHaveLength(1);
    expect(await billing(ids.yearly)).toBe(1);
    expect(await billing(ids.quarterly)).toBe(1);
  });
});

describe("a rejected invoice (#352)", () => {
  const reject = (id: string, toolRef: string | null) =>
    admin`UPDATE invoice SET status = 'rejected', attempts = 10, send_error_kind = 'network',
      tool = ${toolRef ? "fake" : null}, tool_ref = ${toolRef} WHERE id = ${id}`;

  it("is management's only", async () => {
    const [a] = await live(ids.a);
    await reject(a.id, null);
    as("front_desk");
    await expect(sendAgain(a.id)).rejects.toThrow("NEXT_REDIRECT");
    await expect(abandon(a.id)).rejects.toThrow("NEXT_REDIRECT");
    expect((await live(ids.a))[0].status).toBe("rejected");
  });

  it("never held by the tool: sent again by drafting its lines afresh, never billed twice", async () => {
    as("director");
    const [a] = await live(ids.a);
    expect(await sendAgain(a.id)).toEqual({ ok: true, result: "redraft", drafted: 1 });
    const [old] = (await invoices()).filter((i) => i.id === a.id);
    expect(old.status).toBe("cancelled");
    const [fresh] = await live(ids.a);
    expect(fresh).toMatchObject({ status: "to_send", attempts: 0 });
    expect(await billing(ids.yearly)).toBe(1);
    expect(pending).toHaveLength(1);
    // Taken up already: a second click finds nothing to do.
    expect(await sendAgain(a.id)).toEqual({
      ok: false,
      message: "Cette facture n’est plus à reprendre : rechargez la page.",
    });
  });

  it("held by the tool: tried again there at once, its attempts never decreasing", async () => {
    as("director");
    const [a] = await live(ids.a);
    await reject(a.id, "zz-ref");
    expect(await sendAgain(a.id)).toEqual({ ok: true, result: "retry_in_tool" });
    const [row] = await live(ids.a);
    expect(row).toMatchObject({ id: a.id, status: "tool_draft", attempts: 10, send_error_kind: null, due: true });
    expect(pending).toHaveLength(1);
  });

  it("abandoned: set aside, its lines back on the payer's next drafting", async () => {
    as("director");
    const [a] = await live(ids.a);
    await reject(a.id, "zz-ref");
    expect(await billing(ids.yearly)).toBe(1);
    expect(await abandon(a.id)).toEqual({ ok: true, result: "abandoned" });
    expect(await live(ids.a)).toHaveLength(0);
    expect(await billing(ids.yearly)).toBe(0);
    as("front_desk");
    expect(await draft()).toEqual({ ok: true, drafted: 1 });
    expect(await billing(ids.yearly)).toBe(1);
    const audit = await admin`SELECT after FROM audit_log WHERE row_id = ${a.id} AND action = 'update' ORDER BY id`;
    expect(audit.at(-1)?.after).toEqual({ status: "cancelled", reason: "abandoned" });
  });

  it("refuses an invoice not rejected, of another school, or with a payment allocated", async () => {
    as("director");
    const [b] = await live(ids.b);
    const gone = { ok: false, message: "Cette facture n’est plus à reprendre : rechargez la page." };
    expect(await abandon(b.id)).toEqual(gone);
    expect(await sendAgain("not-a-uuid")).toEqual({ ok: false, message: "Facture introuvable : rechargez la page." });
    // Another school's rejected invoice: out of reach (RLS).
    const otherEntity = (await admin`SELECT id FROM billing_entity WHERE school_id = ${ids.other}`)[0].id;
    const [{ id: foreign }] = await admin`INSERT INTO invoice (school_id, billing_entity_id, payer_id, status, attempts)
      VALUES (${ids.other}, ${otherEntity}, ${ids.otherPayer}, 'rejected', 10) RETURNING id`;
    expect(await abandon(foreign)).toEqual(gone);
    expect((await admin`SELECT status FROM invoice WHERE id = ${foreign}`)[0].status).toBe("rejected");
    // A rejected invoice with a payment allocated to its installment.
    const [{ id: paid }] = await admin`INSERT INTO invoice (school_id, billing_entity_id, payer_id, season_id, status,
        attempts, total_incl_tax_cents) VALUES (${ids.school}, ${ids.b}, ${ids.payer}, ${ids.season}, 'rejected', 10, 5000)
      RETURNING id`;
    const [{ id: inst }] =
      await admin`INSERT INTO installment (school_id, billing_entity_id, invoice_id, rank, due_date,
        amount_cents) VALUES (${ids.school}, ${ids.b}, ${paid}, 1, '2027-10-01', 5000) RETURNING id`;
    const [{ id: payment }] =
      await admin`INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, date)
      VALUES (${ids.school}, ${ids.b}, ${ids.payer}, 5000, 'cash', '2027-10-01') RETURNING id`;
    await admin`INSERT INTO payment_allocation (school_id, billing_entity_id, payment_id, installment_id, amount_cents)
      VALUES (${ids.school}, ${ids.b}, ${payment}, ${inst}, 5000)`;
    const paidRefusal = {
      ok: false,
      message:
        "Un paiement est affecté à une échéance de cette facture : elle ne peut pas être abandonnée ni refaite ici.",
    };
    expect(await abandon(paid)).toEqual(paidRefusal);
    expect(await sendAgain(paid)).toEqual(paidRefusal);
    expect((await admin`SELECT status FROM invoice WHERE id = ${paid}`)[0].status).toBe("rejected");
  });
});

describe("sending after the answer", () => {
  it("leaves a business's fake tool state to its own store", () => {
    // The fake tool kept B's issued invoice in its memory, never A's held draft.
    expect(fakeStoreOf(ids.a).calls).not.toContain("createInvoice");
    expect(fakeStoreOf(ids.b).calls.filter((c) => c === "finalize")).toHaveLength(1);
  });
});
