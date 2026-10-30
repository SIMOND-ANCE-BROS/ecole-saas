import postgres from "postgres";
import { withDefaultQuarters } from "./season-quarters.integration-helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REASON_REQUIRED } from "../domain/enrollment/manual-price";
import {
  confirmationPreview,
  confirmEnrollment,
  enrollmentPreview,
  type EnrollmentInput,
  saveEnrollment,
  seasonEnrollments,
  STALE_MANUAL_PRICE,
} from "./enrollments";
import { withSchool } from "./index";
import { schoolWithDefaultEntity } from "./billing-entity.integration-helpers";

/**
 * A price typed by the front desk on an enrollment (#292), run as the application
 * (app_user, RLS) on a school with two businesses (#299). Fictitious data deleted at
 * the end, the audit log included.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const frontDesk = `zz-accueil-prix-${suffix}`;
const teacher = `zz-prof-prix-${suffix}`;
const ids = {} as Record<string, string>;

beforeAll(async () => {
  [{ id: ids.school }] = await schoolWithDefaultEntity(admin, "Zz École prix saisi", `zzps-${suffix}`);
  const s = ids.school;
  [{ id: ids.a }] = await admin`SELECT id FROM billing_entity WHERE school_id = ${s} AND is_default`;
  [{ id: ids.b }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, default_vat_treatment_id)
    VALUES (${s}, 'Zz Entreprise B', 'Zz Entreprise B', 'not_applicable',
      (SELECT default_vat_treatment_id FROM billing_entity WHERE school_id = ${s} AND is_default)) RETURNING id`;
  for (const [user, role] of [
    [frontDesk, "front_desk"],
    [teacher, "teacher"],
  ] as const) {
    await admin`INSERT INTO "user" (id, name, email) VALUES (${user}, 'Zz Compte', ${`${user}@exemple.test`})`;
    await admin`INSERT INTO member (school_id, user_id, role) VALUES (${s}, ${user}, ${role})`;
  }
  [{ id: ids.season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${s}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  await withDefaultQuarters(admin, ids.season);
  for (const [combination, price] of [
    ["{45}", 8500],
    ["{60}", 11000],
    ["{45,60}", 16500],
  ] as const)
    await admin`INSERT INTO tariff (school_id, season_id, audience, period, combination, price_cents)
      VALUES (${s}, ${ids.season}, 'child', 'quarter', ${combination}::smallint[], ${price})`;
  await admin`INSERT INTO discount (school_id, season_id, code, rate_bps, min_students, audiences, combinable_with_multi_discipline)
    VALUES (${s}, ${ids.season}, 'fratrie', 1000, 2, '{child}', false)`;
  const [site] = await admin`INSERT INTO site (school_id, name, address) VALUES (${s}, 'Zz Site', 'Zz') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${s}, ${site.id}, 'Zz Salle') RETURNING id`;
  const [instructor] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${s}, 'Zzprof', 'Zz', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  const [jazz] = await admin`INSERT INTO discipline (school_id, name) VALUES (${s}, 'Zzjazz') RETURNING id`;
  const course = async (entity: string, minutes: number, day: number) =>
    (
      await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${s}, ${entity}, ${ids.season}, ${jazz.id}, ${room.id}, ${instructor.id}, ${day}, '17:00', ${minutes}) RETURNING id`
    )[0].id as string;
  ids.jazz60 = await course(ids.a, 60, 1);
  ids.jazz45 = await course(ids.a, 45, 2);
  ids.jazz60bis = await course(ids.a, 60, 3);
  ids.jazz60tris = await course(ids.a, 60, 5);
  ids.jazzB = await course(ids.b, 45, 4);
  for (const [key, first] of [
    ["payer", "Zzparent"],
    ["zoe", "Zzzoé"],
    ["noe", "Zznoé"],
    ["lea", "Zzléa"],
    ["otherPayer", "Zzautreparent"],
    ["tom", "Zztom"],
    ["eve", "Zzève"],
  ] as const)
    [{ id: ids[key] }] =
      await admin`INSERT INTO person (school_id, last_name, first_name, is_student) VALUES (${s}, 'Zzfamille', ${first}, ${!key.endsWith("ayer")}) RETURNING id`;
  for (const [payer, student] of [
    [ids.payer, ids.zoe],
    [ids.payer, ids.noe],
    [ids.payer, ids.lea],
    [ids.otherPayer, ids.tom],
    [ids.otherPayer, ids.eve],
  ])
    await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for) VALUES (${s}, ${payer}, ${student}, 'legal_guardian', true)`;
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id = ${ids.school}`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of [
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
    "season",
    "member",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [ids.school]);
  await admin`DELETE FROM "user" WHERE id IN (${frontDesk}, ${teacher})`;
  await admin`DELETE FROM school WHERE id = ${ids.school}`;
  await admin.end();
});

const child = (studentId: string, courseIds: string[], extra: Partial<EnrollmentInput> = {}): EnrollmentInput => ({
  studentIds: [studentId],
  audience: "child",
  period: "quarter",
  courseIds,
  // The tests enroll the same students in the same courses again: not a duplicate check (#333).
  duplicatesConfirmed: true,
  ...extra,
});
// Enrolled before the season's first quarter: a quarterly enrollment covers its three quarters (#291).
const ENROLLED_ON = "2026-09-15";
const save = (entry: EnrollmentInput, user = frontDesk) =>
  withSchool(ids.school, (tx) => saveEnrollment(tx, user, ids.payer, ids.season, entry, ENROLLED_ON));
const row = async (id: string) =>
  (
    await admin`SELECT tariff_id, gross_price_cents, discount_cents, manual_price_cents, price_reason, net_price_cents, discounts
      FROM enrollment WHERE id = ${id}`
  )[0];
const audit = async (id: string) =>
  (await admin`SELECT action, after, actor IS NOT NULL AS signed FROM audit_log WHERE row_id = ${id} ORDER BY id`)[0];
const count = async () =>
  (await admin`SELECT count(*)::int AS n FROM enrollment WHERE school_id = ${ids.school}`)[0].n as number;

describe("price typed by the front desk (#292)", () => {
  it("saves an enrollment without a typed price at the grid price, written to the audit log", async () => {
    const r = await save(child(ids.zoe, [ids.jazz60]));
    if (!r.ok) throw new Error(r.message);
    expect(await row(r.id)).toMatchObject({
      gross_price_cents: 11000,
      manual_price_cents: null,
      net_price_cents: 11000,
    });
    const log = await audit(r.id);
    expect(log).toMatchObject({ action: "insert", signed: true });
    expect(log.after).toMatchObject({ grossPriceCents: 11000, discountCents: 0, courseIds: [ids.jazz60] });
    expect(log.after).not.toHaveProperty("reason");
  });

  it("refuses a combination missing from the grid without a price", async () => {
    const before = await count();
    const r = await save(child(ids.noe, [ids.jazz60, ids.jazz60bis, ids.jazz60tris]));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toContain("prix à saisir par l’accueil");
    expect(await count()).toBe(before);
  });

  it("saves a combination missing from the grid at the typed price, with its reason", async () => {
    const r = await save(
      child(ids.lea, [ids.jazz60, ids.jazz60bis, ids.jazz60tris], {
        manualPrices: [{ billingEntityId: ids.a, priceCents: 21000, reason: "  Trois cours, prix convenu " }],
      }),
    );
    if (!r.ok) throw new Error(r.message);
    expect(await row(r.id)).toMatchObject({
      tariff_id: null,
      gross_price_cents: 21000,
      discount_cents: 0,
      manual_price_cents: 21000,
      price_reason: "Trois cours, prix convenu",
      net_price_cents: 21000,
      discounts: [],
    });
    expect((await audit(r.id)).after).toMatchObject({
      manualPriceCents: 21000,
      computedNetPriceCents: null,
      reason: "Trois cours, prix convenu",
    });
  });

  it("refuses a typed price without a reason, in French, saving nothing", async () => {
    const before = await count();
    const r = await save(
      child(ids.noe, [ids.jazz45, ids.jazz60], {
        manualPrices: [{ billingEntityId: ids.a, priceCents: 9000, reason: " " }],
      }),
    );
    expect(r).toEqual({ ok: false, message: REASON_REQUIRED });
    expect(await count()).toBe(before);
  });

  it("refuses a typed price from a teacher", async () => {
    const r = await save(
      child(ids.noe, [ids.jazz45, ids.jazz60], {
        manualPrices: [{ billingEntityId: ids.a, priceCents: 9000, reason: "Geste" }],
      }),
      teacher,
    );
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("rôle") });
  });

  it("saves a price lower than the grid's (pro rata): the siblings discount is computed, the typed price is final", async () => {
    // Siblings (Zoé and Léa already enrolled): 16 500 less 10 % = 14 850 on the grid.
    const r = await save(
      child(ids.noe, [ids.jazz45, ids.jazz60], {
        manualPrices: [{ billingEntityId: ids.a, priceCents: 9900, reason: "Inscription en cours de trimestre" }],
      }),
    );
    if (!r.ok) throw new Error(r.message);
    expect(await row(r.id)).toMatchObject({
      gross_price_cents: 16500,
      discount_cents: 1650,
      discounts: ["fratrie"],
      manual_price_cents: 9900,
      net_price_cents: 9900,
    });
    expect((await audit(r.id)).after).toMatchObject({ manualPriceCents: 9900, computedNetPriceCents: 14850 });
    const listed = await withSchool(ids.school, (tx) => seasonEnrollments(tx, { payerId: ids.payer }, ids.season));
    expect(listed.find((e) => e.id === r.id)).toMatchObject({
      netPriceCents: 9900,
      priceReason: "Inscription en cours de trimestre",
    });
  });

  it("does not report a typed-price enrollment whose siblings discount would change: its price stays the typed one", async () => {
    // Tom alone: no siblings discount, a typed price. Ève's enrollment would give him one.
    const tom = await withSchool(ids.school, (tx) =>
      saveEnrollment(
        tx,
        frontDesk,
        ids.otherPayer,
        ids.season,
        child(ids.tom, [ids.jazz60], {
          manualPrices: [{ billingEntityId: ids.a, priceCents: 5000, reason: "Inscription en cours de trimestre" }],
        }),
        ENROLLED_ON,
      ),
    );
    if (!tom.ok) throw new Error(tom.message);
    const p = await withSchool(ids.school, (tx) =>
      enrollmentPreview(tx, ids.otherPayer, ids.season, child(ids.eve, [ids.jazz60]), ENROLLED_ON),
    );
    if (p.status !== "ok") throw new Error(p.message);
    expect(p.newEnrollments[0].price).toMatchObject({ status: "ok", discountCents: 1100 });
    expect(p.existingImpacts).toEqual([]);
  });

  it("saves a price higher than the grid's, and keeps none when the typed price is the computed one", async () => {
    const higher = await save(
      child(ids.zoe, [ids.jazz45], {
        status: "waitlist",
        manualPrices: [{ billingEntityId: ids.a, priceCents: 9500, reason: "Cours de rattrapage inclus" }],
      }),
    );
    if (!higher.ok) throw new Error(higher.message);
    expect(await row(higher.id)).toMatchObject({ manual_price_cents: 9500, net_price_cents: 9500 });

    // Siblings: 8 500 less 10 % = 7 650, typed as is: nothing kept, no reason needed.
    const same = await save(
      child(ids.zoe, [ids.jazz45], { manualPrices: [{ billingEntityId: ids.a, priceCents: 7650, reason: "" }] }),
    );
    if (!same.ok) throw new Error(same.message);
    expect(await row(same.id)).toMatchObject({ manual_price_cents: null, price_reason: null, net_price_cents: 7650 });
  });

  it("refuses a typed price for a business none of the chosen courses belongs to", async () => {
    const r = await save(
      child(ids.zoe, [ids.jazz60], { manualPrices: [{ billingEntityId: ids.b, priceCents: 100, reason: "Geste" }] }),
    );
    expect(r).toEqual({ ok: false, message: STALE_MANUAL_PRICE });
  });

  it("prices each business's enrollment on its own: a typed price for one, the grid for the other", async () => {
    const r = await save(
      child(ids.lea, [ids.jazz60, ids.jazzB], {
        manualPrices: [{ billingEntityId: ids.b, priceCents: 4000, reason: "Arrivée en février" }],
      }),
    );
    if (!r.ok) throw new Error(r.message);
    const rows = await admin`SELECT billing_entity_id AS entity, manual_price_cents AS manual, net_price_cents AS net
      FROM enrollment WHERE id IN ${admin(r.ids)}`;
    // Siblings: 11 000 less 10 % = 9 900 on the default business's enrollment.
    expect(rows).toEqual(
      expect.arrayContaining([
        { entity: ids.a, manual: null, net: 9900 },
        { entity: ids.b, manual: 4000, net: 4000 },
      ]),
    );
  });

  it("names the business whose price is refused when the submission creates two enrollments", async () => {
    const r = await save(
      child(ids.lea, [ids.jazz60, ids.jazzB], {
        manualPrices: [{ billingEntityId: ids.b, priceCents: 4000, reason: "" }],
      }),
    );
    expect(r).toEqual({ ok: false, message: `Zz Entreprise B : ${REASON_REQUIRED}` });
  });

  it("confirms a waitlist enrollment priced by hand off the grid, keeping its typed price", async () => {
    const w = await save(
      child(ids.zoe, [ids.jazz60, ids.jazz60bis, ids.jazz60tris], {
        status: "waitlist",
        manualPrices: [{ billingEntityId: ids.a, priceCents: 20000, reason: "Prix convenu" }],
      }),
    );
    if (!w.ok) throw new Error(w.message);
    const p = await withSchool(ids.school, (tx) => confirmationPreview(tx, w.id));
    if (p.status !== "ok") throw new Error(p.message);
    expect(p).toMatchObject({
      price: { status: "error" },
      manualPrice: { priceCents: 20000, reason: "Prix convenu" },
      netPriceCents: 20000,
      savedNetPriceCents: 20000,
    });
    expect(await withSchool(ids.school, (tx) => confirmEnrollment(tx, frontDesk, w.id, 20000))).toEqual({
      ok: true,
      id: w.id,
    });
    expect(await row(w.id)).toMatchObject({ manual_price_cents: 20000, net_price_cents: 20000 });
  });

  it("confirms a trial priced by hand on the grid: the grid price is recomputed under it, the typed price stays", async () => {
    const trial = await withSchool(ids.school, (tx) =>
      saveEnrollment(
        tx,
        frontDesk,
        ids.otherPayer,
        ids.season,
        child(ids.eve, [ids.jazz45], {
          status: "trial",
          manualPrices: [{ billingEntityId: ids.a, priceCents: 6000, reason: "Arrivée en cours de trimestre" }],
        }),
        ENROLLED_ON,
      ),
    );
    if (!trial.ok) throw new Error(trial.message);
    const p = await withSchool(ids.school, (tx) => confirmationPreview(tx, trial.id));
    // Grid: 8 500 less 10 % (Tom is a sibling) = 7 650; the typed price stays.
    expect(p).toMatchObject({ price: { status: "ok", netPriceCents: 7650 }, netPriceCents: 6000 });
    // The grid's price is not what was shown: refused.
    expect(await withSchool(ids.school, (tx) => confirmEnrollment(tx, frontDesk, trial.id, 7650))).toMatchObject({
      ok: false,
      message: expect.stringContaining("Le prix a changé"),
    });
    expect(await withSchool(ids.school, (tx) => confirmEnrollment(tx, frontDesk, trial.id, 6000))).toEqual({
      ok: true,
      id: trial.id,
    });
    expect(await row(trial.id)).toMatchObject({
      gross_price_cents: 8500,
      discount_cents: 850,
      manual_price_cents: 6000,
      net_price_cents: 6000,
    });
    const [log] = await admin`SELECT before, after FROM audit_log WHERE row_id = ${trial.id} AND action = 'update'`;
    expect(log.before).toMatchObject({ status: "trial", netPriceCents: 6000, manualPriceCents: 6000 });
    expect(log.after).toMatchObject({
      status: "active",
      netPriceCents: 6000,
      manualPriceCents: 6000,
      reason: "Arrivée en cours de trimestre",
    });
  });

  it("refuses a waitlist enrollment off the grid without a typed price at confirmation", async () => {
    // Not possible through saveEnrollment: written directly, as a row from before #292 could be.
    const [e] = await admin`
      INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, status, gross_price_cents)
      VALUES (${ids.school}, ${ids.a}, ${ids.season}, ${ids.payer}, 'child', 'quarter', 'waitlist', 0) RETURNING id`;
    await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id)
      SELECT ${ids.school}, ${ids.a}, ${e.id}, ${ids.zoe}, c FROM unnest(${[ids.jazz60, ids.jazz60bis, ids.jazz60tris]}::uuid[]) c`;
    const r = await withSchool(ids.school, (tx) => confirmEnrollment(tx, frontDesk, e.id, 0));
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("prix à saisir") });
  });

  it("the database refuses a typed price without a reason", async () => {
    await expect(admin`
      INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents, manual_price_cents)
      VALUES (${ids.school}, ${ids.a}, ${ids.season}, ${ids.payer}, 'child', 'quarter', 100, 50)`).rejects.toThrow(
      /enrollment_manual_price/,
    );
  });
});
