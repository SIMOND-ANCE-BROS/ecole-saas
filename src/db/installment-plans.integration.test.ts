import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schoolWithDefaultEntity } from "./billing-entity.integration-helpers";
import { withSchool } from "./index";
import { draftPayerInvoices } from "./invoice-drafts";
import { offeredPlans, readInstallmentPlans, saveInstallmentPlans } from "./installment-plans";
import { DEFAULT_INSTALLMENT_PLANS } from "../domain/invoicing/plans";

/**
 * Installment plans (#176) against the real database, run as the application (app_user, RLS):
 * the school's setting, its checks, and a draft due by the chosen plan, kept when drafted
 * again, a refused plan leaving the previous drafts as they were. Fictitious data, deleted at
 * the end.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const ids = {} as Record<string, string>;
const RIBAS = { counts: [1, 3, 10], dueDay: 5, roundingUnitCents: 100 };
const SEASON = { startDate: "2027-09-01", endDate: "2028-06-30" };

beforeAll(async () => {
  [{ id: ids.school }] = await schoolWithDefaultEntity(admin, "Zz École échéances", `zzech-${suffix}`);
  [{ id: ids.other }] = await schoolWithDefaultEntity(admin, "Zz École voisine", `zzechv-${suffix}`);
  const s = ids.school;
  [{ id: ids.entity, default_vat_treatment_id: ids.exempt }] =
    await admin`SELECT id, default_vat_treatment_id FROM billing_entity WHERE school_id = ${s} AND is_default`;
  [{ id: ids.season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${s}, '2027-2028', ${SEASON.startDate}, ${SEASON.endDate}) RETURNING id`;
  [{ id: ids.jazz }] = await admin`INSERT INTO discipline (school_id, name) VALUES (${s}, 'Zz Jazz') RETURNING id`;
  const [site] = await admin`INSERT INTO site (school_id, name, address) VALUES (${s}, 'Zz Site', 'Zz') RETURNING id`;
  [{ id: ids.room }] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${s}, ${site.id}, 'Zz Salle') RETURNING id`;
  [{ id: ids.teacher }] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${s}, 'Zzprof', 'Zz', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  [{ id: ids.course }] = await admin`
    INSERT INTO course (school_id, season_id, billing_entity_id, vat_treatment_id, discipline_id, room_id, instructor_id,
      weekday, start_time, duration_minutes)
    VALUES (${s}, ${ids.season}, ${ids.entity}, ${ids.exempt}, ${ids.jazz}, ${ids.room}, ${ids.teacher}, 3, '17:00', 60)
    RETURNING id`;
  [{ id: ids.payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${s}, 'Zzfamille', 'Zzparent') RETURNING id`;
  // Three siblings, each on a yearly package of 415,00 € with the siblings discount: 373,50 € each.
  for (const n of [1, 2, 3]) {
    const [student] = await admin`INSERT INTO person (school_id, last_name, first_name, is_student)
      VALUES (${s}, 'Zzfamille', ${`Zzenfant${n}`}, true) RETURNING id`;
    const [e] = await admin`
      INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, enrolled_on,
        gross_price_cents, discount_cents, discounts)
      VALUES (${s}, ${ids.entity}, ${ids.season}, ${ids.payer}, 'child', 'year', '2027-06-20', 41500, 4150, '{fratrie}')
      RETURNING id`;
    await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id)
      VALUES (${s}, ${ids.entity}, ${e.id}, ${student.id}, ${ids.course})`;
  }
});

afterAll(async () => {
  const s = ids.school;
  await admin.begin(async (t) => {
    await t.unsafe(`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`);
    for (const table of ["invoice_line", "installment", "invoice", "audit_log"])
      await t.unsafe(`DELETE FROM ${table} WHERE school_id = ANY($1)`, [[s, ids.other]]);
    await t.unsafe(`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`);
  });
  for (const t of [
    "enrollment_course",
    "enrollment",
    "course",
    "person",
    "instructor",
    "discipline",
    "room",
    "site",
    "season",
    "installment_plan_setting",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = ANY($1)`, [[s, ids.other]]);
  await admin`DELETE FROM school WHERE id IN ${admin([s, ids.other])}`;
  await admin.end();
});

const draft = (installmentCount: number | undefined, today: string) =>
  withSchool(ids.school, (tx) => draftPayerInvoices(tx, null, ids.payer, ids.season, { installmentCount, today }));
const dues = () => admin`SELECT i.installment_count, d.rank, d.due_date::text AS due_date, d.amount_cents
  FROM invoice i JOIN installment d ON d.invoice_id = i.id
  WHERE i.school_id = ${ids.school} AND i.status = 'to_send' ORDER BY d.rank`;

describe("installment_plan_setting (#176)", () => {
  it("a school with no setting follows the default", async () => {
    expect(await withSchool(ids.school, (tx) => readInstallmentPlans(tx))).toEqual(DEFAULT_INSTALLMENT_PLANS);
  });

  it("saves the school's plans, sorted, writes the change to the audit log, and only for its school", async () => {
    expect(
      await withSchool(ids.school, (tx) => saveInstallmentPlans(tx, "no-such-user", { ...RIBAS, counts: [10, 3, 1] })),
    ).toEqual({ ok: true });
    expect(await withSchool(ids.school, (tx) => readInstallmentPlans(tx))).toEqual(RIBAS);
    expect(await withSchool(ids.other, (tx) => readInstallmentPlans(tx))).toEqual(DEFAULT_INSTALLMENT_PLANS);
    const logged = await admin`SELECT after FROM audit_log
      WHERE school_id = ${ids.school} AND target_table = 'installment_plan_setting'`;
    expect(logged.map((l) => l.after)).toEqual([{ counts: [1, 3, 10], due_day: 5, rounding_unit_cents: 100 }]);
  });

  it("the database refuses a count out of 1 to 12, a due day past the 28th and another rounding", async () => {
    for (const [counts, dueDay, rounding] of [
      ["{0}", 5, 100],
      ["{13}", 5, 100],
      ["{}", 5, 100],
      ["{1,NULL}", 5, 100],
      ["{3}", 29, 100],
      ["{3}", 5, 50],
    ] as const)
      await expect(
        admin`INSERT INTO installment_plan_setting (school_id, counts, due_day, rounding_unit_cents)
          VALUES (${ids.other}, ${counts}::smallint[], ${dueDay}, ${rounding})`,
      ).rejects.toThrow(/installment_plan_setting_/);
  });

  it("offers the plans that fit the season", async () => {
    const season = { ...SEASON };
    expect(await withSchool(ids.school, (tx) => offeredPlans(tx, season, "2027-11-12"))).toEqual({
      counts: [1, 3],
      tooLong: [10],
      dueDay: 5,
      seasonEnd: "2028-06-30",
      noneLeft: false,
    });
  });
});

describe("drafting by a plan (#176)", () => {
  it("three siblings in 3 installments: to the euro, the cents on the first, the plan recorded", async () => {
    expect(await draft(3, "2027-06-20")).toMatchObject({ ok: true });
    expect((await dues()).map((d) => [d.installment_count, d.rank, d.due_date, d.amount_cents])).toEqual([
      [3, 1, "2027-09-05", 37450],
      [3, 2, "2027-10-05", 37300],
      [3, 3, "2027-11-05", 37300],
    ]);
  });

  it("drafting again without a choice keeps the plan", async () => {
    expect(await draft(undefined, "2027-06-20")).toMatchObject({ ok: true });
    expect((await dues()).map((d) => d.amount_cents)).toEqual([37450, 37300, 37300]);
  });

  it("10 installments that no longer fit are refused, and the drafts stay as they were", async () => {
    const [before] = await admin`SELECT id FROM invoice WHERE school_id = ${ids.school} AND status = 'to_send'`;
    expect(await draft(10, "2027-11-12")).toEqual({
      ok: false,
      message: "Le paiement en 10 fois finirait après la fin de la saison : choisissez moins d’échéances.",
    });
    const after = await admin`SELECT id FROM invoice WHERE school_id = ${ids.school} AND status = 'to_send'`;
    expect(after.map((i) => i.id)).toEqual([before.id]);
    expect(await dues()).toHaveLength(3);
  });

  it("a plan started mid-season begins at the next 5th", async () => {
    expect(await draft(3, "2028-02-14")).toMatchObject({ ok: true });
    expect((await dues()).map((d) => d.due_date)).toEqual(["2028-03-05", "2028-04-05", "2028-05-05"]);
  });

  it("the database refuses a plan count out of 1 to 12", async () => {
    await expect(
      admin`UPDATE invoice SET installment_count = 13 WHERE school_id = ${ids.school} AND status = 'to_send'`,
    ).rejects.toThrow(/invoice_installment_count/);
  });
});
