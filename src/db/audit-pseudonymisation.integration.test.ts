import postgres from "postgres";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, withSchool } from "./index";
import { defaultEntityFor } from "./billing-entity.integration-helpers";
import { dueEntries, pseudonymiseDue, pseudonymiseEntries } from "./audit-pseudonymisation";
import { PERSONAL_KEYS, PLACEHOLDER, redactEntry } from "../domain/audit/pseudonymise";

/**
 * Pseudonymisation of the audit log (#184, migration 0069, ADR 0010), against the real database:
 * the trigger still refuses every ordinary change, the function replaces personal values only,
 * money values stay, another school is never touched, and the « end of relationship » rule picks
 * the right entries. Fictitious data deleted at the end (the audit log's trigger disabled inside an
 * administration transaction, as the other tests do).
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const TODAY = "2026-11-16"; // cutoff: 2023-11-16
const OLD = "2020-01-15T10:00:00Z";
const activeUser = `zz-actif-${suffix}`;
const goneUser = `zz-parti-${suffix}`;
const activeEmail = `${activeUser}@exemple.test`;
const goneEmail = `${goneUser}@exemple.test`;
let school: string;
let other: string;

/** A person of `schoolId`, its record created on `createdAt`. */
const person = async (schoolId: string, createdAt = OLD) =>
  (
    await admin`INSERT INTO person (school_id, last_name, first_name, created_at)
      VALUES (${schoolId}, 'Zz', 'Zoé', ${createdAt}) RETURNING id`
  )[0].id as string;

/** An audit entry inserted as the administration role; returns its id. */
async function entry(e: {
  schoolId?: string;
  table: string;
  rowId?: string;
  action?: string;
  before?: object | null;
  after?: object | null;
  at?: string;
}): Promise<number> {
  const [{ id }] = await admin`
    INSERT INTO audit_log (school_id, target_table, row_id, action, before, after, at)
    VALUES (${e.schoolId ?? school}, ${e.table}, ${e.rowId ?? crypto.randomUUID()}, ${e.action ?? "insert"},
            ${e.before ? admin.json(e.before as postgres.JSONValue) : null},
            ${e.after ? admin.json(e.after as postgres.JSONValue) : null},
            ${e.at ?? new Date().toISOString()})
    RETURNING id`;
  return Number(id);
}

const read = async (id: number) =>
  (await admin<{ before: unknown; after: unknown }[]>`SELECT before, after FROM audit_log WHERE id = ${id}`)[0];

/** The database's error message for `fn` run in a rolled-back admin transaction, or "accepted". */
async function refusal(fn: (t: postgres.TransactionSql) => Promise<unknown>): Promise<string> {
  try {
    await admin.begin(async (t) => {
      await fn(t);
      throw new Error("accepted");
    });
  } catch (e) {
    return (e as Error).message;
  }
  return "accepted";
}

// Entries of school A
let oldEnrollment: number; // payer and student gone since 2020: due
let paidRecently: number; // payer signed this season's rules: not due
let newStudent: number; // payer gone, student's record created this year: not due
let oldPack: number; // due
let oldSignupDeleted: number; // workshop sign-up deleted, `priceReason`: due
let namesNobody: number; // a reason naming no person: never chosen
let cancelledInvoice: number; // payer gone, with a cancelled and a rejected draft never issued: due
let invoiceOnItsWay: number; // payer gone but with an invoice still to send: not due
let paidThisYear: number; // payer gone but paid in 2026: not due
let livePack: number; // a pack bought this season, its payer read from the live row only: not due
let cancelledWithStudent: number; // enrollment cancelled, its student under `courses[*]` created this year: not due
let oldPayment: number; // a payment entry of a gone payer: no personal key, never touched
let goneInvitation: number; // expired in 2021, address of a member deactivated in 2022: due
let memberInvitation: number; // expired in 2021, address of an active member: not due
let reinvited: number; // expired in 2021, same address invited again in 2026: not due
let malformed: number; // an `expiresAt` that is not a date: never due, and fails nothing
let otherSchoolEntry: number; // school B, same as `oldEnrollment`

const enrollmentAfter = (payerId: string, studentIds: string[]) => ({
  payerId,
  seasonId: crypto.randomUUID(),
  status: "active",
  studentIds,
  courseIds: [crypto.randomUUID()],
  grossPriceCents: 45_000,
  discountCents: 4_500,
  manualPriceCents: 30_000,
  computedNetPriceCents: 40_500,
  reason: "Zz accord de la direction",
});

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zz', ${`ap-${suffix}`}) RETURNING id`;
  [{ id: other }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zx', ${`aq-${suffix}`}) RETURNING id`;
  const gonePayer = await person(school);
  const goneStudent = await person(school);
  const rulesPayer = await person(school);
  const recentStudent = await person(school, "2026-09-02T08:00:00Z");
  const [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  await admin`INSERT INTO rules_acceptance (school_id, payer_id, season_id, accepted_on)
    VALUES (${school}, ${rulesPayer}, ${season}, '2026-09-05')`;

  oldEnrollment = await entry({ table: "enrollment", after: enrollmentAfter(gonePayer, [goneStudent]), at: OLD });
  paidRecently = await entry({ table: "enrollment", after: enrollmentAfter(rulesPayer, [goneStudent]), at: OLD });
  newStudent = await entry({ table: "enrollment", after: enrollmentAfter(gonePayer, [recentStudent]), at: OLD });
  oldPack = await entry({
    table: "lesson_pack",
    after: {
      payerId: gonePayer,
      participantIds: [goneStudent],
      priceCents: 9_000,
      gridPriceCents: 10_000,
      reason: "Zz",
    },
  });
  oldSignupDeleted = await entry({
    table: "workshop_signup",
    action: "delete",
    before: {
      payerId: gonePayer,
      participantIds: [goneStudent],
      unitPriceCents: 1_500,
      priceReason: "Zz",
      signedUpOn: "2020-03-01",
    },
  });
  namesNobody = await entry({ table: "enrollment", action: "update", after: { status: "active", reason: "Zz" } });

  const entity = await defaultEntityFor(admin, school);
  const [{ treatment }] =
    await admin`SELECT default_vat_treatment_id AS treatment FROM billing_entity WHERE id = ${entity}`;
  const cancelledPayer = await person(school);
  await admin`INSERT INTO invoice (school_id, billing_entity_id, payer_id, status)
    VALUES (${school}, ${entity}, ${cancelledPayer}, 'cancelled'), (${school}, ${entity}, ${cancelledPayer}, 'rejected')`;
  cancelledInvoice = await entry({ table: "enrollment", after: enrollmentAfter(cancelledPayer, []), at: OLD });
  const draftPayer = await person(school);
  await admin`INSERT INTO invoice (school_id, billing_entity_id, payer_id, status)
    VALUES (${school}, ${entity}, ${draftPayer}, 'to_send')`;
  invoiceOnItsWay = await entry({ table: "enrollment", after: enrollmentAfter(draftPayer, []), at: OLD });
  const payingPayer = await person(school);
  await admin`INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, date)
    VALUES (${school}, ${entity}, ${payingPayer}, 5000, 'cash', '2026-10-01')`;
  paidThisYear = await entry({
    table: "lesson_pack",
    after: { payerId: payingPayer, priceCents: 5_000, reason: "Zz" },
  });
  const packPayer = await person(school);
  const [{ id: pack }] = await admin`INSERT INTO lesson_pack
      (school_id, payer_id, billing_entity_id, vat_treatment_id, people_count, lesson_count, price_cents, purchased_on)
    VALUES (${school}, ${packPayer}, ${entity}, ${treatment}, 1, 5, 20000, '2026-09-10') RETURNING id`;
  livePack = await entry({ table: "lesson_pack", rowId: pack, after: { priceCents: 20_000, reason: "Zz" } });
  cancelledWithStudent = await entry({
    table: "enrollment",
    action: "delete",
    before: {
      payerId: gonePayer,
      grossPriceCents: 45_000,
      reason: "Zz",
      courses: [{ studentId: recentStudent, courseId: crypto.randomUUID() }],
    },
  });
  oldPayment = await entry({
    table: "payment",
    after: { montant_centimes: 12_000, method: "cheque", date: "2020-01-15", reason: "Zz" },
  });

  await admin`INSERT INTO "user" (id, name, email) VALUES (${activeUser}, 'Zz Actif', ${activeEmail}),
    (${goneUser}, 'Zz Parti', ${goneEmail})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${activeUser}, 'front_desk')`;
  const [{ id: goneMember }] = await admin`INSERT INTO member (school_id, user_id, role, active)
    VALUES (${school}, ${goneUser}, 'front_desk', false) RETURNING id`;
  await entry({
    table: "member",
    rowId: goneMember,
    action: "update",
    before: { role: "front_desk", active: true },
    after: { role: "front_desk", active: false },
    at: "2022-01-10T10:00:00Z",
  });
  const invitation = (email: string, expiresAt: string) => ({
    id: crypto.randomUUID(),
    type: "invitation",
    email,
    role: "front_desk",
    userId: null,
    createdBy: null,
    expiresAt,
  });
  goneInvitation = await entry({ table: "invitation", after: invitation(goneEmail, "2021-03-08T10:00:00.000Z") });
  memberInvitation = await entry({ table: "invitation", after: invitation(activeEmail, "2021-03-08T10:00:00.000Z") });
  const again = `zz-encore-${suffix}@exemple.test`;
  reinvited = await entry({ table: "invitation", after: invitation(again, "2021-03-08T10:00:00.000Z") });
  await entry({ table: "invitation", after: invitation(again.toUpperCase(), "2026-11-20T10:00:00.000Z") });
  malformed = await entry({ table: "invitation", after: invitation(`zz-x-${suffix}@exemple.test`, "bientôt") });

  const otherPayer = await person(other);
  otherSchoolEntry = await entry({
    schoolId: other,
    table: "enrollment",
    after: enrollmentAfter(otherPayer, []),
    at: OLD,
  });
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${other})`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
    await t`ALTER TABLE payment DISABLE TRIGGER payment_immutable`;
    await t.unsafe("DELETE FROM payment WHERE school_id IN ($1, $2)", [school, other]);
    await t`ALTER TABLE payment ENABLE TRIGGER payment_immutable`;
  });
  for (const t of ["invoice", "lesson_pack", "member", "rules_acceptance", "season", "person"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, other]);
  await admin`DELETE FROM "user" WHERE id IN (${activeUser}, ${goneUser})`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${other})`;
  await admin.end();
});

describe("the audit log trigger (migration 0069)", () => {
  it("refuses app_user any update or delete, even a redaction", async () => {
    const update = await withSchool(school, (tx) =>
      tx.execute(sql`UPDATE audit_log SET after = after || '{"reason": "[pseudonymisé]"}' WHERE id = ${oldPack}`),
    ).catch((e: Error) => e.cause ?? e);
    expect(String((update as Error).message)).toMatch(/permission denied/);
    const removal = await withSchool(school, (tx) =>
      tx.execute(sql`DELETE FROM audit_log WHERE id = ${oldPack}`),
    ).catch((e: Error) => e.cause ?? e);
    expect(String((removal as Error).message)).toMatch(/permission denied/);
  });

  it("refuses, even to the owner, a change of an amount, a date or an id", async () => {
    const refused = "The audit log can be neither modified nor deleted";
    expect(
      await refusal(
        (t) => t`UPDATE audit_log SET after = jsonb_set(after, '{grossPriceCents}', '1') WHERE id = ${oldEnrollment}`,
      ),
    ).toBe(refused);
    expect(
      await refusal(
        (t) =>
          t`UPDATE audit_log SET after = jsonb_set(after, '{payerId}', to_jsonb(${PLACEHOLDER}::text)) WHERE id = ${oldEnrollment}`,
      ),
    ).toBe(refused);
    expect(await refusal((t) => t`UPDATE audit_log SET at = now() WHERE id = ${oldEnrollment}`)).toBe(refused);
    expect(
      await refusal((t) => t`UPDATE audit_log SET row_id = ${crypto.randomUUID()} WHERE id = ${oldEnrollment}`),
    ).toBe(refused);
  });

  it("refuses a personal value replaced by anything but the placeholder, a key dropped or added", async () => {
    const refused = "The audit log can be neither modified nor deleted";
    expect(
      await refusal(
        (t) => t`UPDATE audit_log SET after = jsonb_set(after, '{reason}', '"Zz autre"') WHERE id = ${oldEnrollment}`,
      ),
    ).toBe(refused);
    expect(await refusal((t) => t`UPDATE audit_log SET after = after - 'reason' WHERE id = ${oldEnrollment}`)).toBe(
      refused,
    );
    expect(
      await refusal(
        (t) => t`UPDATE audit_log SET after = after || '{"note": "[pseudonymisé]"}' WHERE id = ${oldEnrollment}`,
      ),
    ).toBe(refused);
    // A key named like a personal one, on a table without personal keys.
    expect(
      await refusal(
        (t) =>
          t`UPDATE audit_log SET after = jsonb_set(after, '{reason}', to_jsonb(${PLACEHOLDER}::text)) WHERE id = ${oldPayment}`,
      ),
    ).toBe(refused);
  });

  it("lets only the placeholder replace a personal value", async () => {
    expect(
      await refusal(
        (t) =>
          t`UPDATE audit_log SET after = jsonb_set(after, '{reason}', to_jsonb(${PLACEHOLDER}::text)) WHERE id = ${oldEnrollment}`,
      ),
    ).toBe("accepted");
  });

  it("refuses every delete and truncate, even to the owner", async () => {
    expect(await refusal((t) => t`DELETE FROM audit_log WHERE id = ${oldEnrollment}`)).toBe(
      "The audit log can be neither modified nor deleted",
    );
    expect(await refusal((t) => t`TRUNCATE audit_log`)).toBe("The audit log cannot be truncated");
  });
});

describe("pseudonymise_audit_entries", () => {
  it("lists the same personal keys as the code", async () => {
    const rows = await admin<{ target_table: string; key: string }[]>`SELECT * FROM audit_personal_keys()`;
    const inDb = rows.map((r) => `${r.target_table}.${r.key}`).sort();
    const inCode = Object.entries(PERSONAL_KEYS)
      .flatMap(([t, keys]) => keys.map((k) => `${t}.${k}`))
      .sort();
    expect(inDb).toEqual(inCode);
    const [{ placeholder }] = await admin`SELECT audit_placeholder() AS placeholder`;
    expect(placeholder).toBe(PLACEHOLDER);
  });

  it("redacts as the code does", async () => {
    const samples = [
      { targetTable: "enrollment", before: { status: "trial", reason: "Zz" }, after: enrollmentAfter("p", ["s"]) },
      { targetTable: "invitation", before: null, after: { email: "zz@exemple.test", role: "director", name: null } },
      { targetTable: "workshop_signup", before: { priceReason: "Zz", reason: 3 }, after: {} },
      { targetTable: "payment", before: null, after: { reason: "Zz", montant_centimes: 1 } },
    ];
    for (const s of samples) {
      const [r] = await admin<{ before: unknown; after: unknown }[]>`
        SELECT audit_redacted(${s.targetTable}, ${s.before ? admin.json(s.before as postgres.JSONValue) : null}) AS before,
               audit_redacted(${s.targetTable}, ${admin.json(s.after as postgres.JSONValue)}) AS after`;
      const expected = redactEntry(s);
      expect(r).toEqual({ before: expected.before, after: expected.after });
    }
  });

  it("refuses to run outside a school", async () => {
    const e = await db
      .execute(sql`SELECT pseudonymise_audit_entries(ARRAY[${oldPack}]::bigint[])`)
      .catch((x: Error) => x);
    expect(String((e as Error).cause ?? e)).toMatch(/runs inside withSchool/);
  });

  it("never touches another school's entries", async () => {
    const changed = await withSchool(school, (tx) => pseudonymiseEntries(tx, [otherSchoolEntry]));
    expect(changed).toBe(0);
    expect((await read(otherSchoolEntry)).after).toMatchObject({ reason: "Zz accord de la direction" });
  });
});

describe("pseudonymisation of the due entries (proposed end of the relationship)", () => {
  it("chooses the entries of people gone for 3 years and invitees gone for 3 years", async () => {
    const due = await withSchool(school, (tx) => dueEntries(tx, TODAY));
    expect(due.sort((a, b) => a - b)).toEqual(
      [oldEnrollment, oldPack, oldSignupDeleted, goneInvitation, cancelledInvoice].sort((a, b) => a - b),
    );
    expect(due).not.toContain(paidRecently);
    expect(due).not.toContain(newStudent);
    expect(due).not.toContain(namesNobody);
    expect(due).toContain(cancelledInvoice);
    expect(due).not.toContain(invoiceOnItsWay);
    expect(due).not.toContain(paidThisYear);
    expect(due).not.toContain(livePack);
    expect(due).not.toContain(cancelledWithStudent);
    expect(due).not.toContain(oldPayment);
    expect(due).not.toContain(memberInvitation);
    expect(due).not.toContain(reinvited);
    expect(due).not.toContain(malformed);
    expect(due).not.toContain(otherSchoolEntry);
  });

  it("replaces their personal values only, keeps amounts, ids and dates, and logs ids and a count", async () => {
    const before = await read(oldEnrollment);
    const payment = await read(oldPayment);
    const run = await pseudonymiseDue((fn) => withSchool(school, fn), TODAY);
    expect(run.pseudonymised).toBe(5);

    expect((await read(oldEnrollment)).after).toEqual({ ...(before.after as object), reason: PLACEHOLDER });
    expect((await read(oldPack)).after).toMatchObject({
      priceCents: 9_000,
      gridPriceCents: 10_000,
      reason: PLACEHOLDER,
    });
    expect((await read(oldSignupDeleted)).before).toMatchObject({ unitPriceCents: 1_500, priceReason: PLACEHOLDER });
    expect((await read(goneInvitation)).after).toMatchObject({ email: PLACEHOLDER, role: "front_desk" });
    // Not due, or not personal: unchanged.
    expect(await read(oldPayment)).toEqual(payment);
    expect((await read(paidRecently)).after).toMatchObject({ reason: "Zz accord de la direction" });
    expect((await read(memberInvitation)).after).toMatchObject({ email: activeEmail });
    expect((await read(otherSchoolEntry)).after).toMatchObject({ reason: "Zz accord de la direction" });

    const logs = await admin<{ after: { pseudonymised: number; ids: number[] }; actor: string | null }[]>`
      SELECT after, actor FROM audit_log WHERE school_id = ${school} AND target_table = 'audit_log'`;
    expect(logs).toHaveLength(1);
    expect(logs[0].actor).toBeNull();
    expect(logs[0].after.pseudonymised).toBe(5);
    expect(logs[0].after.ids.map(Number).sort((a, b) => a - b)).toEqual(
      [oldEnrollment, oldPack, oldSignupDeleted, goneInvitation, cancelledInvoice].sort((a, b) => a - b),
    );
    expect(Object.keys(logs[0].after).sort()).toEqual(["ids", "pseudonymised"]);
  });

  it("changes nothing, and logs nothing, when run again", async () => {
    const run = await pseudonymiseDue((fn) => withSchool(school, fn), TODAY);
    expect(run.pseudonymised).toBe(0);
    expect(await withSchool(school, (tx) => pseudonymiseEntries(tx, [oldEnrollment, oldPack]))).toBe(0);
    const [{ n }] =
      await admin`SELECT count(*)::int AS n FROM audit_log WHERE school_id = ${school} AND target_table = 'audit_log'`;
    expect(n).toBe(1);
  });

  it("reports the keys no list classifies, by name only", async () => {
    // Every key of the fixtures above is classified (`payment` is school data); one more is not.
    const run = await pseudonymiseDue((fn) => withSchool(school, fn), TODAY);
    expect(run.unclassified).toEqual([]);
    await entry({ table: "enrollment", after: { phone: "Zz" } });
    const again = await pseudonymiseDue((fn) => withSchool(school, fn), TODAY);
    expect(again.unclassified).toEqual(["enrollment.phone"]);
  });
});
