import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schoolWithDefaultEntity } from "./billing-entity.integration-helpers";
import { confirmEnrollment, enrollmentPreview, saveEnrollment } from "./enrollments";
import { withSchool } from "./index";
import { draftPayerInvoices } from "./invoice-drafts";
import { withDefaultQuarters } from "./season-quarters.integration-helpers";

/**
 * Siblings discount from the 2nd child, the most expensive package paying full price (#290),
 * and a discount raised by a new sibling (#155 Q2): saved at once on an enrollment nothing
 * bills yet, its unsent draft thrown away; only reported once an invoice bills it. Run as the
 * application (app_user, RLS); fictitious data deleted at the end.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const ids = {} as Record<string, string>;
const frontDesk = `sub-accueil-zzrank-${suffix}`;
// Before the season's first quarter: a quarterly enrollment covers its three quarters (#291).
const ENROLLED_ON = "2026-09-15";

beforeAll(async () => {
  [{ id: ids.school }] = await schoolWithDefaultEntity(admin, "Zz École fratrie", `zzrank-${suffix}`);
  const s = ids.school;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${frontDesk}, 'Zz Accueil', ${`${frontDesk}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${s}, ${frontDesk}, 'front_desk')`;
  [{ id: ids.season }] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${s}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  await withDefaultQuarters(admin, ids.season);
  for (const [combination, price] of [
    ["{45}", 8500],
    ["{60}", 11000],
  ] as const) {
    await admin`INSERT INTO tariff (school_id, season_id, audience, period, combination, price_cents)
      VALUES (${s}, ${ids.season}, 'child', 'quarter', ${combination}::smallint[], ${price})`;
  }
  // The demo school's rule: -10 % from 2 children, the most expensive package at full price.
  await admin`INSERT INTO discount (school_id, season_id, code, rate_bps, min_students, from_rank, audiences, combinable_with_multi_discipline)
    VALUES (${s}, ${ids.season}, 'fratrie', 1000, 2, 2, '{child}', false)`;
  const [site] = await admin`INSERT INTO site (school_id, name, address) VALUES (${s}, 'Zz Site', 'Zz') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${s}, ${site.id}, 'Zz Salle') RETURNING id`;
  const [teacher] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${s}, 'Zzprof', 'Zz', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  const [jazz] = await admin`INSERT INTO discipline (school_id, name) VALUES (${s}, 'Zz Jazz') RETURNING id`;
  for (const [key, duration, day] of [
    ["jazz45", 45, 1],
    ["jazz60", 60, 2],
  ] as const) {
    [{ id: ids[key] }] =
      await admin`INSERT INTO course (school_id, billing_entity_id, vat_treatment_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      SELECT ${s}, e.id, e.default_vat_treatment_id, ${ids.season}, ${jazz.id}, ${room.id}, ${teacher.id}, ${day}, '17:00', ${duration}
      FROM billing_entity e WHERE e.school_id = ${s} AND e.is_default RETURNING id`;
  }
  // One family per case, two children each.
  for (const family of ["f1", "f2", "f3", "f4", "f5"]) {
    [{ id: ids[family] }] =
      await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${s}, ${`Zz${family}`}, 'Zzparent') RETURNING id`;
    for (const child of ["a", "b"]) {
      const key = `${family}${child}`;
      [{ id: ids[key] }] =
        await admin`INSERT INTO person (school_id, last_name, first_name, is_student) VALUES (${s}, ${`Zz${family}`}, ${`Zz${child}`}, true) RETURNING id`;
      await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for)
        VALUES (${s}, ${ids[family]}, ${ids[key]}, 'legal_guardian', true)`;
    }
  }
});

afterAll(async () => {
  const s = ids.school;
  const triggers = [
    ["invoice", "invoice_issued_immutable"],
    ["invoice_line", "invoice_line_immutable"],
    ["installment", "installment_immutable"],
    ["audit_log", "audit_log_append_only"],
  ];
  await admin.begin(async (t) => {
    for (const [table, trigger] of triggers) await t.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
    for (const table of ["invoice_line", "installment", "invoice", "audit_log"])
      await t.unsafe(`DELETE FROM ${table} WHERE school_id = $1`, [s]);
    for (const [table, trigger] of triggers) await t.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
  });
  for (const t of [
    "enrollment_quarter",
    "enrollment_course",
    "enrollment",
    "course",
    "relationship",
    "person",
    "instructor",
    "room",
    "site",
    "discipline",
    "discount",
    "tariff",
    "season_quarter",
    "season",
    "member",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [s]);
  await admin`DELETE FROM "user" WHERE id = ${frontDesk}`;
  await admin`DELETE FROM school WHERE id = ${s}`;
  await admin.end();
});

const entry = (studentId: string, courseId: string, status?: "trial") => ({
  studentIds: [studentId],
  audience: "child" as const,
  period: "quarter" as const,
  courseIds: [courseId],
  ...(status ? { status } : {}),
});

const preview = (payer: string, e: ReturnType<typeof entry>) =>
  withSchool(ids.school, (tx) => enrollmentPreview(tx, ids[payer], ids.season, e, ENROLLED_ON));

async function save(payer: string, e: ReturnType<typeof entry>): Promise<string> {
  const r = await withSchool(ids.school, (tx) => saveEnrollment(tx, frontDesk, ids[payer], ids.season, e, ENROLLED_ON));
  if (!r.ok) throw new Error(r.message);
  return r.id;
}

async function saved(id: string) {
  const [row] = await admin`SELECT discount_cents, net_price_cents, discounts FROM enrollment WHERE id = ${id}`;
  return row;
}

describe("siblings discount from the 2nd child (#290)", () => {
  it("a cheaper newcomer gets the discount; the child saved first keeps full price, nothing to report", async () => {
    const first = await save("f1", entry(ids.f1a, ids.jazz60));
    const p = await preview("f1", entry(ids.f1b, ids.jazz45));
    if (p.status !== "ok") throw new Error(p.message);
    expect(p.newEnrollments[0].price).toMatchObject({ grossPriceCents: 8500, discountCents: 850 });
    expect(p.existingImpacts).toEqual([]);
    const second = await save("f1", entry(ids.f1b, ids.jazz45));
    expect(await saved(first)).toMatchObject({ discount_cents: 0, net_price_cents: 11000 });
    expect(await saved(second)).toMatchObject({ discount_cents: 850, net_price_cents: 7650, discounts: ["fratrie"] });
  });

  it("a newcomer at the same price pays the discount, the child saved first keeps full price", async () => {
    const first = await save("f5", entry(ids.f5a, ids.jazz60));
    const second = await save("f5", entry(ids.f5b, ids.jazz60));
    expect(await saved(first)).toMatchObject({ discount_cents: 0 });
    expect(await saved(second)).toMatchObject({ discount_cents: 1100 });
  });
});

describe("a discount raised by a new sibling (#155 Q2)", () => {
  it("is saved at once on the sibling nothing bills yet, the newcomer paying full price", async () => {
    const cheaper = await save("f2", entry(ids.f2a, ids.jazz45));
    const p = await preview("f2", entry(ids.f2b, ids.jazz60));
    if (p.status !== "ok") throw new Error(p.message);
    expect(p.newEnrollments[0].price).toMatchObject({ grossPriceCents: 11000, discountCents: 0 });
    expect(p.existingImpacts).toMatchObject([
      { reference: cheaper, savedDeposit: 0, recalculatedDiscount: 850, applied: true },
    ]);
    const expensive = await save("f2", entry(ids.f2b, ids.jazz60));
    expect(await saved(cheaper)).toMatchObject({ discount_cents: 850, net_price_cents: 7650, discounts: ["fratrie"] });
    expect(await saved(expensive)).toMatchObject({ discount_cents: 0, net_price_cents: 11000 });
    const [log] = await admin`SELECT before, after FROM audit_log
      WHERE school_id = ${ids.school} AND row_id = ${cheaper} AND action = 'update'`;
    expect(log).toMatchObject({
      before: { discountCents: 0, netPriceCents: 8500 },
      after: { discountCents: 850, netPriceCents: 7650, raisedBy: [expensive] },
    });
  });

  it("throws the sibling's unsent draft away, drafted again at the raised discount", async () => {
    const cheaper = await save("f3", entry(ids.f3a, ids.jazz45));
    const drafted = await withSchool(ids.school, (tx) => draftPayerInvoices(tx, null, ids.f3, ids.season));
    if (!drafted.ok) throw new Error(drafted.message);
    expect(drafted.invoiceIds).toHaveLength(1);
    await save("f3", entry(ids.f3b, ids.jazz60));
    expect(await admin`SELECT id FROM invoice WHERE id = ${drafted.invoiceIds[0]}`).toHaveLength(0);
    expect(await saved(cheaper)).toMatchObject({ discount_cents: 850 });
    const again = await withSchool(ids.school, (tx) => draftPayerInvoices(tx, null, ids.f3, ids.season));
    if (!again.ok) throw new Error(again.message);
    const [{ total }] =
      await admin`SELECT sum(total_incl_tax_cents)::int AS total FROM invoice WHERE id IN ${admin(again.invoiceIds)}`;
    // Three quarters each: the 2nd child at 76,50 €, the most expensive at 110,00 €.
    expect(total).toBe(3 * (7650 + 11000));
  });

  it("is only reported once an invoice other than an unsent draft bills the sibling", async () => {
    const cheaper = await save("f4", entry(ids.f4a, ids.jazz45));
    const drafted = await withSchool(ids.school, (tx) => draftPayerInvoices(tx, null, ids.f4, ids.season));
    if (!drafted.ok) throw new Error(drafted.message);
    // The outbox attempted it: the tool may hold it, it counts as invoiced (#304).
    await admin`UPDATE invoice SET attempts = 1 WHERE id = ${drafted.invoiceIds[0]}`;
    const trial = await save("f4", entry(ids.f4b, ids.jazz60, "trial"));
    const confirmed = await withSchool(ids.school, (tx) => confirmEnrollment(tx, frontDesk, trial, 11000));
    if (!confirmed.ok) throw new Error(confirmed.message);
    expect(await saved(cheaper)).toMatchObject({ discount_cents: 0, net_price_cents: 8500 });
    expect(await admin`SELECT id FROM invoice WHERE id = ${drafted.invoiceIds[0]}`).toHaveLength(1);
  });
});
