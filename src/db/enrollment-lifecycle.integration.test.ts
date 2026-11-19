import postgres from "postgres";
import { withDefaultQuarters } from "./season-quarters.integration-helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import {
  cancelEnrollment,
  confirmEnrollment,
  confirmationPreview,
  dropEnrollment,
  dropPaidDraft,
  droppedPlanNotice,
  leavingImpacts,
  saveEnrollment,
  seasonEnrollments,
  takenCourses,
} from "./enrollments";
import { readPerson } from "./people";
import { readAttendance, saveAttendance } from "./lessons";
import { enrolledInCourse } from "./schedule";
import { balanceOf } from "./payments";
import { overlapping } from "./overlap.integration-helpers";
import { defaultEntityFor } from "./billing-entity.integration-helpers";
import { draftPayerInvoices } from "./invoice-drafts";

/**
 * Enrollment lifecycle (#284), run as the application (app_user, RLS): confirm a trial
 * or waitlist enrollment, record a drop-out, cancel a mistake. Fictitious data deleted
 * at the end; the audit log being append-only, the cleanup disables its trigger for the
 * duration of an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const desk = `cycle-accueil-${suffix}`;
let school: string;
let otherSchool: string;
let entity: string;
const ids: Record<string, string> = {};
/** Quarters of each school's season (#291), which every quarterly enrollment of `family` covers. */
const quarters: Record<string, string[]> = {};

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École C', ${`ca-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École D', ${`cb-${suffix}`}) RETURNING id`;
  entity = await defaultEntityFor(admin, school);
  await defaultEntityFor(admin, otherSchool);
  await admin`INSERT INTO "user" (id, name, email) VALUES (${desk}, 'Accueil Test', ${`${desk}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${desk}, 'front_desk'), (${otherSchool}, ${desk}, 'front_desk')`;
  for (const s of [school, otherSchool]) {
    const [season] =
      await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${s}, '2027-2028', '2027-09-01', '2028-06-30') RETURNING id`;
    ids[`season-${s}`] = season.id;
    quarters[s] = await withDefaultQuarters(admin, season.id);
    await admin`INSERT INTO tariff (school_id, season_id, audience, period, combination, price_cents)
      VALUES (${s}, ${season.id}, 'child', 'quarter', '{60}'::smallint[], 11000)`;
    await admin`INSERT INTO discount (school_id, season_id, code, rate_bps, min_students, audiences, combinable_with_multi_discipline)
      VALUES (${s}, ${season.id}, 'fratrie', 1000, 2, '{child}', false)`;
    const [site] =
      await admin`INSERT INTO site (school_id, name, address) VALUES (${s}, 'Site', 'Adresse') RETURNING id`;
    const [room] =
      await admin`INSERT INTO room (school_id, site_id, name) VALUES (${s}, ${site.id}, 'Salle') RETURNING id`;
    const [teacher] =
      await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${s}, 'Prof', 'Test', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
    const [jazz] = await admin`INSERT INTO discipline (school_id, name) VALUES (${s}, 'Jazz') RETURNING id`;
    const [c] =
      await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${s}, (SELECT id FROM billing_entity WHERE school_id = ${s} AND is_default), ${season.id}, ${jazz.id}, ${room.id}, ${teacher.id}, 1, '17:00', 60) RETURNING id`;
    ids[`course-${s}`] = c.id;
    // A 45-minute course: with the 60-minute one, no package of the grid fits (no tariff for {45,60}).
    const [c45] =
      await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${s}, (SELECT id FROM billing_entity WHERE school_id = ${s} AND is_default), ${season.id}, ${jazz.id}, ${room.id}, ${teacher.id}, 2, '17:00', 45) RETURNING id`;
    ids[`course45-${s}`] = c45.id;
    for (const date of ["2027-11-08", "2027-11-15", "2027-11-22"]) {
      const [l] = await admin`INSERT INTO lesson (school_id, course_id, date, instructor_id)
        VALUES (${s}, ${c.id}, ${date}, ${teacher.id}) RETURNING id`;
      ids[`lesson-${s}-${date}`] = l.id;
    }
  }
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE payment DISABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${otherSchool})`;
    await t`DELETE FROM payment_allocation WHERE school_id IN (${school}, ${otherSchool})`;
    await t`DELETE FROM payment WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE payment ENABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of [
    "invoice_line",
    "installment",
    "invoice",
    "attendance",
    "enrollment_course",
    "enrollment",
    "lesson",
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
    "installment_plan_setting",
    "member",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM "user" WHERE id = ${desk}`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

/** A payer and their children, each enrolled in the season's course with `status`. */
async function family(
  s: string,
  statuses: string[],
): Promise<{ payer: string; students: string[]; enrollments: string[] }> {
  const [payer] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${s}, 'Zz-Famille', 'Parent') RETURNING id`;
  const students: string[] = [];
  const enrollments: string[] = [];
  for (const [n, status] of statuses.entries()) {
    const [child] =
      await admin`INSERT INTO person (school_id, last_name, first_name, is_student) VALUES (${s}, 'Zz-Famille', ${`Enfant${n}`}, true) RETURNING id`;
    await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for) VALUES (${s}, ${payer.id}, ${child.id}, 'legal_guardian', true)`;
    const [e] = await admin`
      INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents, status)
      VALUES (${s}, (SELECT id FROM billing_entity WHERE school_id = ${s} AND is_default), ${ids[`season-${s}`]}, ${payer.id}, 'child', 'quarter', 11000, ${status}) RETURNING id`;
    await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id) VALUES (${s}, (SELECT billing_entity_id FROM enrollment WHERE id = ${e.id}), ${e.id}, ${child.id}, ${ids[`course-${s}`]})`;
    for (const quarter of quarters[s])
      await admin`INSERT INTO enrollment_quarter (school_id, enrollment_id, quarter_id) VALUES (${s}, ${e.id}, ${quarter})`;
    students.push(child.id);
    enrollments.push(e.id);
  }
  return { payer: payer.id, students, enrollments };
}

const inSchool = <T>(run: Parameters<typeof withSchool<T>>[1]) => withSchool(school, run);
const auditOf = (id: string) =>
  admin`SELECT action, before, after, actor FROM audit_log WHERE row_id = ${id} ORDER BY id`;
const sheet = async (date: string) =>
  ((await inSchool((tx) => readAttendance(tx, ids[`lesson-${school}-${date}`]))) ?? { students: [] }).students.map(
    (d) => d.id,
  );

/** Attendance of `student` on the lesson of `date`, taken by hand. */
const take = (date: string, student: string, present: boolean) =>
  admin`INSERT INTO attendance (school_id, lesson_id, student_id, present)
    VALUES (${school}, ${ids[`lesson-${school}-${date}`]}, ${student}, ${present})`;

describe("confirming a trial or waitlist enrollment", () => {
  it("recomputes the price with the payer's active enrollments, saves it only when confirmed, and logs it", async () => {
    const f = await family(school, ["active", "trial"]);
    const [, trial] = f.enrollments;
    const preview = await inSchool((tx) => confirmationPreview(tx, trial));
    if (preview.status !== "ok" || preview.price.status !== "ok") throw new Error("expected a price");
    // Siblings discount with the active sibling; the active one's saved discount (0) would change: reported.
    expect(preview.price).toMatchObject({ grossPriceCents: 11000, discountCents: 1100, netPriceCents: 9900 });
    expect(preview.savedNetPriceCents).toBe(11000);
    expect(preview.existingImpacts).toMatchObject([{ reference: f.enrollments[0], recalculatedDiscount: 1100 }]);
    // Nothing saved by the preview.
    expect((await admin`SELECT status FROM enrollment WHERE id = ${trial}`)[0].status).toBe("trial");

    expect(await inSchool((tx) => confirmEnrollment(tx, desk, trial, 9900))).toEqual({ ok: true, id: trial });
    const [row] =
      await admin`SELECT status, gross_price_cents, discount_cents, discounts, tariff_id FROM enrollment WHERE id = ${trial}`;
    expect(row).toMatchObject({
      status: "active",
      gross_price_cents: 11000,
      discount_cents: 1100,
      discounts: ["fratrie"],
    });
    expect(row.tariff_id).not.toBeNull();
    // The sibling saved before, which nothing bills yet, gets the discount the confirmation raises (#155 Q2).
    expect((await admin`SELECT discount_cents FROM enrollment WHERE id = ${f.enrollments[0]}`)[0].discount_cents).toBe(
      1100,
    );
    expect(await auditOf(f.enrollments[0])).toMatchObject([
      { action: "update", before: { discountCents: 0 }, after: { discountCents: 1100, raisedBy: [trial] } },
    ]);
    const [log] = await auditOf(trial);
    expect(log).toMatchObject({
      action: "update",
      before: { status: "trial", grossPriceCents: 11000, discountCents: 0 },
      after: { status: "active", grossPriceCents: 11000, discountCents: 1100 },
    });
    expect(log.actor).not.toBeNull();
  });

  it("a second click or a retry changes nothing and logs nothing more", async () => {
    const f = await family(school, ["waitlist"]);
    const [e] = f.enrollments;
    expect(await inSchool((tx) => confirmEnrollment(tx, desk, e, 11000))).toEqual({ ok: true, id: e });
    expect(await inSchool((tx) => confirmEnrollment(tx, desk, e, 11000))).toEqual({ ok: true, id: e, already: true });
    expect(await auditOf(e)).toHaveLength(1);
  });

  it("refuses when the price changed since it was shown, saving nothing", async () => {
    const f = await family(school, ["trial"]);
    const [e] = f.enrollments;
    expect(await inSchool((tx) => confirmEnrollment(tx, desk, e, 9900))).toEqual({
      ok: false,
      message: "Le prix a changé depuis son affichage : vérifiez-le avant de confirmer.",
    });
    expect((await admin`SELECT status FROM enrollment WHERE id = ${e}`)[0].status).toBe("trial");
    expect(await auditOf(e)).toHaveLength(0);
  });

  it("refuses when the engine cannot price the enrollment, saving nothing", async () => {
    const f = await family(school, ["trial"]);
    const [e] = f.enrollments;
    await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id)
      VALUES (${school}, (SELECT billing_entity_id FROM enrollment WHERE id = ${e}), ${e}, ${f.students[0]}, ${ids[`course45-${school}`]})`;
    const preview = await inSchool((tx) => confirmationPreview(tx, e));
    expect(preview).toMatchObject({ status: "ok", price: { status: "error" } });
    expect(await inSchool((tx) => confirmEnrollment(tx, desk, e, 11000))).toMatchObject({ ok: false });
    expect((await admin`SELECT status FROM enrollment WHERE id = ${e}`)[0].status).toBe("trial");
    expect(await auditOf(e)).toHaveLength(0);
  });

  it("refuses to confirm a drop-out, with a French message", async () => {
    const f = await family(school, ["active"]);
    const [e] = f.enrollments;
    expect(await inSchool((tx) => dropEnrollment(tx, desk, e, "2027-11-15"))).toMatchObject({ ok: true });
    expect(await inSchool((tx) => confirmEnrollment(tx, desk, e, 11000))).toEqual({
      ok: false,
      message: "Cette inscription est abandonnée : elle ne peut plus changer de statut.",
    });
  });

  it("two confirmations at the same moment: one change, one audit entry", async () => {
    const f = await family(school, ["trial"]);
    const [e] = f.enrollments;
    const [a, b] = await overlapping(
      admin,
      (hold) =>
        inSchool(async (tx) => {
          const r = await confirmEnrollment(tx, desk, e, 11000);
          await hold();
          return r;
        }),
      () => inSchool((tx) => confirmEnrollment(tx, desk, e, 11000)),
    );
    expect(a).toEqual({ ok: true, id: e });
    expect(b).toEqual({ ok: true, id: e, already: true });
    expect(await auditOf(e)).toHaveLength(1);
  });
});

describe("recording a drop-out", () => {
  it("stores the date; the student leaves attendance sheets after it, lessons before keep it", async () => {
    const f = await family(school, ["active"]);
    const [e] = f.enrollments;
    const [student] = f.students;
    await admin`INSERT INTO attendance (school_id, lesson_id, student_id, present)
      VALUES (${school}, ${ids[`lesson-${school}-2027-11-08`]}, ${student}, true)`;
    expect(await inSchool((tx) => dropEnrollment(tx, desk, e, "2027-11-15"))).toEqual({ ok: true, id: e });
    expect((await admin`SELECT status, dropped_on::text FROM enrollment WHERE id = ${e}`)[0]).toEqual({
      status: "dropped",
      dropped_on: "2027-11-15",
    });
    expect(await sheet("2027-11-08")).toContain(student);
    expect(await sheet("2027-11-15")).toContain(student);
    expect(await sheet("2027-11-22")).not.toContain(student);
    const before = await inSchool((tx) => readAttendance(tx, ids[`lesson-${school}-2027-11-08`]));
    expect(before?.students.find((d) => d.id === student)).toMatchObject({
      status: "dropped",
      droppedOn: "2027-11-15",
      present: true,
    });
    expect(await auditOf(e)).toMatchObject([
      { action: "update", before: { status: "active" }, after: { status: "dropped", droppedOn: "2027-11-15" } },
    ]);
    // On the course list until the drop date only.
    const list = (today: string) =>
      inSchool((tx) => enrolledInCourse(tx, ids[`course-${school}`], today)).then((l) => l.map((i) => i.studentId));
    expect(await list("2027-11-10")).toContain(student);
    expect(await list("2027-11-16")).not.toContain(student);
  });

  it("refuses a date outside the season, and a second drop-out on another date", async () => {
    const f = await family(school, ["trial"]);
    const [e] = f.enrollments;
    expect(await inSchool((tx) => dropEnrollment(tx, desk, e, "2028-07-01"))).toEqual({
      ok: false,
      message: "La date de l’abandon doit être comprise dans la saison de l’inscription.",
    });
    expect(await inSchool((tx) => dropEnrollment(tx, desk, e, "2027-10-01"))).toMatchObject({ ok: true });
    expect(await inSchool((tx) => dropEnrollment(tx, desk, e, "2027-10-01"))).toMatchObject({
      ok: true,
      already: true,
    });
    expect(await inSchool((tx) => dropEnrollment(tx, desk, e, "2027-10-02"))).toEqual({
      ok: false,
      message: "L’abandon de cette inscription est déjà enregistré.",
    });
    expect(await auditOf(e)).toHaveLength(1);
  });

  it("tells which sibling's discount a drop-out would change, without changing it", async () => {
    const f = await family(school, ["active", "active"]);
    await admin`UPDATE enrollment SET discount_cents = 1100 WHERE id IN ${admin(f.enrollments)}`;
    const impacts = await inSchool((tx) => leavingImpacts(tx, f.enrollments[1]));
    expect(impacts).toMatchObject([{ reference: f.enrollments[0], savedDeposit: 1100, recalculatedDiscount: 0 }]);
    await inSchool((tx) => dropEnrollment(tx, desk, f.enrollments[1], "2027-11-15"));
    expect((await admin`SELECT discount_cents FROM enrollment WHERE id = ${f.enrollments[0]}`)[0].discount_cents).toBe(
      1100,
    );
  });

  it("keeps a drop date only on a dropped enrollment (database check)", async () => {
    const f = await family(school, ["active"]);
    await expect(admin`UPDATE enrollment SET dropped_on = '2027-11-15' WHERE id = ${f.enrollments[0]}`).rejects.toThrow(
      /enrollment_dropped_on/,
    );
  });
});

describe("waitlist and drop-outs", () => {
  it("refuses a drop-out from the waitlist (never attended): it is cancelled instead", async () => {
    const f = await family(school, ["waitlist"]);
    expect(await inSchool((tx) => dropEnrollment(tx, desk, f.enrollments[0], "2027-11-15"))).toEqual({
      ok: false,
      message: "Une inscription en attente n’a jamais été suivie : annulez-la plutôt.",
    });
    expect(await sheet("2027-11-08")).not.toContain(f.students[0]);
  });

  it("refuses a drop-out dated before the enrollment day", async () => {
    const f = await family(school, ["active"]);
    await admin`UPDATE enrollment SET enrolled_on = '2027-10-05' WHERE id = ${f.enrollments[0]}`;
    expect(await inSchool((tx) => dropEnrollment(tx, desk, f.enrollments[0], "2027-10-04"))).toEqual({
      ok: false,
      message: "La date de l’abandon ne peut pas précéder l’inscription ni le début de la saison.",
    });
  });

  it("a quarterly drop-out in November owes October–December only, not the following quarters (#99 Q2)", async () => {
    const f = await family(school, ["active"]);
    const [e] = f.enrollments;
    // 110,00 € a quarter, enrolled for the season's three quarters (#291).
    expect((await inSchool((tx) => balanceOf(tx, f.payer, "2027-11-20")))?.total).toMatchObject({ due: 33000 });
    await inSchool((tx) => dropEnrollment(tx, desk, e, "2027-11-15"));
    // The quarter started stays owed in full (neither carried over nor refunded).
    expect((await inSchool((tx) => balanceOf(tx, f.payer, "2027-11-20")))?.total).toMatchObject({
      due: 11000,
      outsideCalculation: {},
    });
    const [listed] = (
      await inSchool((tx) => seasonEnrollments(tx, { payerId: f.payer }, ids[`season-${school}`]))
    ).filter((i) => i.id === e);
    expect(listed).toMatchObject({ quarters: ["1er trimestre"], quarterCount: 1, seasonDueCents: 11000 });
    // The quarters not started are released, their ids in the audit log.
    expect(listed.coveredQuarters.map((q) => q.label)).toEqual(["1er trimestre"]);
    expect(await auditOf(e)).toMatchObject([
      { after: { status: "dropped", droppedOn: "2027-11-15", releasedQuarterIds: quarters[school].slice(1) } },
    ]);
  });

  it("owes the same once dropped when the season's quarter dates are edited afterwards", async () => {
    const f = await family(school, ["active"]);
    await inSchool((tx) => dropEnrollment(tx, desk, f.enrollments[0], "2027-12-20"));
    const [, second] = quarters[school];
    const [{ start }] = await admin`SELECT start_date::text AS start FROM season_quarter WHERE id = ${second}`;
    try {
      // The 2nd quarter now starts before the drop-out day: what was released stays released.
      await admin`UPDATE season_quarter SET start_date = '2027-12-15' WHERE id = ${second}`;
      expect((await inSchool((tx) => balanceOf(tx, f.payer, "2027-12-21")))?.total).toMatchObject({ due: 11000 });
    } finally {
      await admin`UPDATE season_quarter SET start_date = ${start} WHERE id = ${second}`;
    }
  });

  it("a trial dropped without being confirmed owes nothing (#99 Q1, #442), counted with the trials", async () => {
    const f = await family(school, ["trial"]);
    const [e] = f.enrollments;
    await take("2027-11-08", f.students[0], true);
    expect(await inSchool((tx) => dropEnrollment(tx, desk, e, "2027-11-08"))).toEqual({ ok: true, id: e });
    expect((await admin`SELECT dropped_during_trial FROM enrollment WHERE id = ${e}`)[0].dropped_during_trial).toBe(
      true,
    );
    // Nor shown with the trials going on (#449).
    expect((await inSchool((tx) => balanceOf(tx, f.payer, "2027-11-20")))?.total).toMatchObject({
      due: 0,
      outsideCalculation: {},
    });
    // The lesson attended on trial keeps its attendance on the sheet.
    expect(await sheet("2027-11-08")).toContain(f.students[0]);
  });

  it("an enrollment dropped once confirmed is not taken for a trial", async () => {
    const f = await family(school, ["active"]);
    await inSchool((tx) => dropEnrollment(tx, desk, f.enrollments[0], "2027-11-15"));
    expect(
      (await admin`SELECT dropped_during_trial FROM enrollment WHERE id = ${f.enrollments[0]}`)[0].dropped_during_trial,
    ).toBe(false);
  });

  it("keeps a trial mark only on a dropped enrollment (database check)", async () => {
    const f = await family(school, ["trial"]);
    await expect(
      admin`UPDATE enrollment SET dropped_during_trial = true WHERE id = ${f.enrollments[0]}`,
    ).rejects.toThrow(/enrollment_dropped_during_trial/);
  });

  it("a quarterly drop-out on the first day of a quarter owes that quarter too", async () => {
    const f = await family(school, ["active"]);
    await inSchool((tx) => dropEnrollment(tx, desk, f.enrollments[0], "2028-01-01"));
    expect((await inSchool((tx) => balanceOf(tx, f.payer, "2028-01-02")))?.total).toMatchObject({ due: 22000 });
  });

  it("a yearly drop-out still owes its whole price", async () => {
    const f = await family(school, ["active"]);
    await admin`UPDATE enrollment SET period = 'year', gross_price_cents = 30000 WHERE id = ${f.enrollments[0]}`;
    await admin`DELETE FROM enrollment_quarter WHERE enrollment_id = ${f.enrollments[0]}`;
    await inSchool((tx) => dropEnrollment(tx, desk, f.enrollments[0], "2027-11-15"));
    expect((await inSchool((tx) => balanceOf(tx, f.payer, "2027-11-20")))?.total).toMatchObject({ due: 30000 });
  });

  it("a trial enrollment is free (#99 Q1): out of the amount due, shown apart", async () => {
    const f = await family(school, ["trial"]);
    expect((await inSchool((tx) => balanceOf(tx, f.payer, "2027-11-20")))?.total).toMatchObject({
      due: 0,
      outsideCalculation: { trial: 33000 },
    });
  });

  it("drafts again at once an unsent invoice draft billing quarters no longer owed", async () => {
    const f = await family(school, ["active"]);
    const [e] = f.enrollments;
    const [inv] = await admin`INSERT INTO invoice (school_id, billing_entity_id, payer_id, season_id)
      VALUES (${school}, ${entity}, ${f.payer}, ${ids[`season-${school}`]}) RETURNING id`;
    await admin`INSERT INTO invoice_line (school_id, billing_entity_id, invoice_id, label, unit_price_cents, enrollment_id,
        incl_tax_cents, excl_tax_cents, vat_cents, vat_treatment_id, vat_category, vat_mention)
      VALUES (${school}, ${entity}, ${inv.id}, 'Forfait', 11000, ${e}, 33000, 33000, 0,
        (SELECT default_vat_treatment_id FROM billing_entity WHERE id = ${entity}), 'exempt', 'Zz mention')`;
    expect(await inSchool((tx) => dropEnrollment(tx, desk, e, "2027-11-15"))).toEqual({ ok: true, id: e });
    expect(await admin`SELECT id FROM invoice WHERE id = ${inv.id}`).toHaveLength(0);
    // The new draft bills the quarter kept only.
    const drafts =
      await admin`SELECT total_incl_tax_cents FROM invoice WHERE payer_id = ${f.payer} AND status = 'to_send'`;
    expect(drafts.map((d) => d.total_incl_tax_cents)).toEqual([11000]);
  });

  it("keeps an unsent draft when the drop-out leaves every quarter owed (dropped in the last one)", async () => {
    const f = await family(school, ["active"]);
    const [e] = f.enrollments;
    const [inv] =
      await admin`INSERT INTO invoice (school_id, billing_entity_id, payer_id) VALUES (${school}, ${entity}, ${f.payer}) RETURNING id`;
    await admin`INSERT INTO invoice_line (school_id, billing_entity_id, invoice_id, label, unit_price_cents, enrollment_id,
        incl_tax_cents, excl_tax_cents, vat_cents, vat_treatment_id, vat_category, vat_mention)
      VALUES (${school}, ${entity}, ${inv.id}, 'Forfait', 11000, ${e}, 33000, 33000, 0,
        (SELECT default_vat_treatment_id FROM billing_entity WHERE id = ${entity}), 'exempt', 'Zz mention')`;
    expect(await inSchool((tx) => dropEnrollment(tx, desk, e, "2028-05-02"))).toEqual({ ok: true, id: e });
    expect(await admin`SELECT id FROM invoice WHERE id = ${inv.id}`).toHaveLength(1);
  });
});

describe("a drop-out dated before attendance taken (#410)", () => {
  const REFUSED_22 =
    "Une présence est déjà relevée à la séance du 22/11/2027 (Jazz 17:00) : l’abandon ne peut pas être daté avant ce jour.";

  it("is refused before the last lesson with the student marked present, naming that lesson; nothing is saved", async () => {
    const f = await family(school, ["active"]);
    const [e] = f.enrollments;
    await take("2027-11-08", f.students[0], true);
    await take("2027-11-22", f.students[0], true);
    expect(await inSchool((tx) => dropEnrollment(tx, desk, e, "2027-11-15"))).toEqual({
      ok: false,
      message: REFUSED_22,
    });
    expect((await admin`SELECT status, dropped_on FROM enrollment WHERE id = ${e}`)[0]).toEqual({
      status: "active",
      dropped_on: null,
    });
    expect(await auditOf(e)).toHaveLength(0);
    // On that lesson's day the student stays on its sheet: accepted.
    expect(await inSchool((tx) => dropEnrollment(tx, desk, e, "2027-11-22"))).toEqual({ ok: true, id: e });
    expect(await sheet("2027-11-22")).toContain(f.students[0]);
  });

  it("is refused alike when the student was marked absent (#410 Q2)", async () => {
    const f = await family(school, ["trial"]);
    await take("2027-11-22", f.students[0], false);
    expect(await inSchool((tx) => dropEnrollment(tx, desk, f.enrollments[0], "2027-11-21"))).toEqual({
      ok: false,
      message: REFUSED_22,
    });
  });

  it("is accepted when another enrollment of the student keeps that lesson on its sheet", async () => {
    const f = await family(school, ["active"]);
    const [other] = await admin`
      INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents, status)
      VALUES (${school}, ${entity}, ${ids[`season-${school}`]}, ${f.payer}, 'child', 'year', 30000, 'active') RETURNING id`;
    await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id)
      VALUES (${school}, ${entity}, ${other.id}, ${f.students[0]}, ${ids[`course-${school}`]})`;
    await take("2027-11-22", f.students[0], true);
    expect(await inSchool((tx) => dropEnrollment(tx, desk, f.enrollments[0], "2027-11-10"))).toMatchObject({
      ok: true,
    });
    expect(await sheet("2027-11-22")).toContain(f.students[0]);
  });

  it("waits for attendance being saved for the lesson, then sees it and is refused", async () => {
    const f = await family(school, ["active"]);
    const [e] = f.enrollments;
    const lesson = ids[`lesson-${school}-2027-11-22`];
    const [saved, dropped] = await overlapping(
      admin,
      (hold) =>
        inSchool(async (tx) => {
          const r = await saveAttendance(tx, lesson, [{ studentId: f.students[0], present: true }]);
          await hold();
          return r;
        }),
      () => inSchool((tx) => dropEnrollment(tx, desk, e, "2027-11-15")),
    );
    expect(saved).toMatchObject({ ok: true });
    expect(dropped).toEqual({ ok: false, message: REFUSED_22 });
    expect(await sheet("2027-11-22")).toContain(f.students[0]);
  });
});

describe("attendance sheets by status", () => {
  it("shows a trial student, never a waitlisted one", async () => {
    const f = await family(school, ["trial", "waitlist"]);
    const students = await sheet("2027-11-22");
    expect(students).toContain(f.students[0]);
    expect(students).not.toContain(f.students[1]);
  });
});

describe("cancelling a mistaken enrollment", () => {
  it("removes it with its courses, logs ids and amounts, and leaves the payer's payments on the balance", async () => {
    const f = await family(school, ["active"]);
    const [e] = f.enrollments;
    await admin`INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method) VALUES (${school}, ${entity}, ${f.payer}, 5000, 'cash')`;
    expect(await inSchool((tx) => cancelEnrollment(tx, desk, e))).toEqual({ ok: true, id: e });
    expect(await admin`SELECT 1 FROM enrollment WHERE id = ${e}`).toHaveLength(0);
    expect(await admin`SELECT 1 FROM enrollment_course WHERE enrollment_id = ${e}`).toHaveLength(0);
    const [log] = await auditOf(e);
    expect(log).toMatchObject({
      action: "delete",
      before: {
        payerId: f.payer,
        status: "active",
        grossPriceCents: 11000,
        discountCents: 0,
        courses: [{ studentId: f.students[0], courseId: ids[`course-${school}`] }],
      },
    });
    const balance = await inSchool((tx) => balanceOf(tx, f.payer, "2027-11-20"));
    expect(balance?.total).toMatchObject({ due: 0, paid: 5000, remaining: -5000 });
    expect(await inSchool((tx) => cancelEnrollment(tx, desk, e))).toEqual({
      ok: false,
      message: "Cette inscription a déjà été annulée.",
    });
  });

  it("is refused once invoiced, and not offered", async () => {
    const f = await family(school, ["active"]);
    const [e] = f.enrollments;
    // Handed to the invoicing tool: no longer a draft that can be thrown away (#302).
    const [inv] = await admin`INSERT INTO invoice (school_id, billing_entity_id, payer_id, status, number)
      VALUES (${school}, ${entity}, ${f.payer}, 'tool_draft', ${`Zz-${e}`}) RETURNING id`;
    await admin`INSERT INTO invoice_line (school_id, billing_entity_id, invoice_id, label, unit_price_cents, enrollment_id,
        incl_tax_cents, excl_tax_cents, vat_cents, vat_treatment_id, vat_category, vat_mention)
      VALUES (${school}, ${entity}, ${inv.id}, 'Forfait', 11000, ${e}, 11000, 11000, 0,
        (SELECT default_vat_treatment_id FROM billing_entity WHERE id = ${entity}), 'exempt', 'Zz mention')`;
    expect(await inSchool((tx) => cancelEnrollment(tx, desk, e))).toEqual({
      ok: false,
      message: "Cette inscription est facturée : passez par un avoir.",
    });
    const [listed] = (
      await inSchool((tx) => seasonEnrollments(tx, { payerId: f.payer }, ids[`season-${school}`]))
    ).filter((i) => i.id === e);
    expect(listed).toMatchObject({ invoiced: true, actions: { cancel: false, drop: true } });
  });

  it("an unsent invoice draft does not block it: the draft is thrown away with it (#302)", async () => {
    const f = await family(school, ["active"]);
    const [e] = f.enrollments;
    const [inv] =
      await admin`INSERT INTO invoice (school_id, billing_entity_id, payer_id) VALUES (${school}, ${entity}, ${f.payer}) RETURNING id`;
    await admin`INSERT INTO invoice_line (school_id, billing_entity_id, invoice_id, label, unit_price_cents, enrollment_id,
        incl_tax_cents, excl_tax_cents, vat_cents, vat_treatment_id, vat_category, vat_mention)
      VALUES (${school}, ${entity}, ${inv.id}, 'Forfait', 11000, ${e}, 11000, 11000, 0,
        (SELECT default_vat_treatment_id FROM billing_entity WHERE id = ${entity}), 'exempt', 'Zz mention')`;
    await admin`INSERT INTO installment (school_id, billing_entity_id, invoice_id, rank, due_date, amount_cents)
      VALUES (${school}, ${entity}, ${inv.id}, 1, '2027-10-01', 11000)`;
    const [listed] = (
      await inSchool((tx) => seasonEnrollments(tx, { payerId: f.payer }, ids[`season-${school}`]))
    ).filter((i) => i.id === e);
    expect(listed).toMatchObject({ invoiced: false, actions: { cancel: true } });
    expect(await inSchool((tx) => cancelEnrollment(tx, desk, e))).toEqual({ ok: true, id: e });
    expect(await admin`SELECT id FROM invoice WHERE id = ${inv.id}`).toHaveLength(0);
  });

  it("a duplicate entered by mistake stays cancellable when the other enrollment has the attendance", async () => {
    const f = await family(school, ["active"]);
    const [duplicate] = await admin`
      INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents, status)
      VALUES (${school}, (SELECT id FROM billing_entity WHERE school_id = ${school} AND is_default), ${ids[`season-${school}`]}, ${f.payer}, 'child', 'quarter', 11000, 'active') RETURNING id`;
    await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id)
      VALUES (${school}, (SELECT billing_entity_id FROM enrollment WHERE id = ${duplicate.id}), ${duplicate.id}, ${f.students[0]}, ${ids[`course-${school}`]})`;
    await admin`INSERT INTO attendance (school_id, lesson_id, student_id, present)
      VALUES (${school}, ${ids[`lesson-${school}-2027-11-15`]}, ${f.students[0]}, true)`;
    const listed = await inSchool((tx) => seasonEnrollments(tx, { payerId: f.payer }, ids[`season-${school}`]));
    expect(listed.map((i) => i.actions.cancel)).toEqual([true, true]);
    expect(await inSchool((tx) => cancelEnrollment(tx, desk, duplicate.id))).toEqual({ ok: true, id: duplicate.id });
    // The one left now carries the attendance alone: no longer cancellable.
    const [left] = await inSchool((tx) => seasonEnrollments(tx, { payerId: f.payer }, ids[`season-${school}`]));
    expect(left).toMatchObject({
      id: f.enrollments[0],
      actions: { cancel: false },
      cancelRefusal: "Des présences sont déjà relevées pour cette inscription : enregistrez plutôt un abandon.",
    });
  });

  it("is refused once attendance was taken: a drop-out is what happened", async () => {
    const f = await family(school, ["trial"]);
    await admin`INSERT INTO attendance (school_id, lesson_id, student_id, present)
      VALUES (${school}, ${ids[`lesson-${school}-2027-11-08`]}, ${f.students[0]}, true)`;
    expect(await inSchool((tx) => cancelEnrollment(tx, desk, f.enrollments[0]))).toEqual({
      ok: false,
      message: "Des présences sont déjà relevées pour cette inscription : enregistrez plutôt un abandon.",
    });
  });

  it("two cancellations at the same moment: one removal, one audit entry", async () => {
    const f = await family(school, ["waitlist"]);
    const [e] = f.enrollments;
    const [a, b] = await overlapping(
      admin,
      (hold) =>
        inSchool(async (tx) => {
          const r = await cancelEnrollment(tx, desk, e);
          await hold();
          return r;
        }),
      () => inSchool((tx) => cancelEnrollment(tx, desk, e)),
    );
    expect(a).toEqual({ ok: true, id: e });
    expect(b).toEqual({ ok: false, message: "Cette inscription a déjà été annulée." });
    expect(await auditOf(e)).toHaveLength(1);
  });
});

describe("another school's enrollment (RLS)", () => {
  it("is never read, confirmed, dropped nor cancelled", async () => {
    const f = await family(otherSchool, ["trial"]);
    const [e] = f.enrollments;
    expect(await inSchool((tx) => confirmationPreview(tx, e))).toEqual({
      status: "invalid",
      message: "Cette inscription n’existe plus.",
    });
    expect(await inSchool((tx) => confirmEnrollment(tx, desk, e, 11000))).toMatchObject({ ok: false });
    expect(await inSchool((tx) => dropEnrollment(tx, desk, e, "2027-11-15"))).toMatchObject({ ok: false });
    expect(await inSchool((tx) => cancelEnrollment(tx, desk, e))).toMatchObject({ ok: false });
    expect(await inSchool((tx) => leavingImpacts(tx, e))).toEqual([]);
    expect((await admin`SELECT status FROM enrollment WHERE id = ${e}`)[0].status).toBe("trial");
  });
});

describe("seasonEnrollments", () => {
  it("lists every status, for the payer or for a student dancing in it", async () => {
    const f = await family(school, ["active", "waitlist"]);
    await inSchool((tx) => dropEnrollment(tx, desk, f.enrollments[0], "2027-12-01"));
    const byPayer = await inSchool((tx) => seasonEnrollments(tx, { payerId: f.payer }, ids[`season-${school}`]));
    expect(byPayer.map((i) => [i.status, i.droppedOn])).toEqual([
      ["dropped", "2027-12-01"],
      ["waitlist", null],
    ]);
    const byStudent = await inSchool((tx) =>
      seasonEnrollments(tx, { personId: f.students[1] }, ids[`season-${school}`]),
    );
    expect(byStudent.map((i) => i.id)).toEqual([f.enrollments[1]]);
    // Waitlist: confirmed or cancelled, never dropped (it was never attended).
    expect(byStudent[0].actions).toEqual({ confirm: true, drop: false, cancel: true });
  });
});

describe("enrolling a student again in a course they take (#333)", () => {
  const TODAY = "2027-10-01";
  const again = (f: { payer: string; students: string[] }, duplicatesConfirmed?: boolean) =>
    inSchool((tx) =>
      saveEnrollment(
        tx,
        desk,
        f.payer,
        ids[`season-${school}`],
        {
          studentIds: [f.students[0]],
          audience: "child",
          period: "quarter",
          courseIds: [ids[`course-${school}`]],
          duplicatesConfirmed,
        },
        TODAY,
      ),
    );

  it("lists the season's courses a student takes, not through a dropped enrollment", async () => {
    const f = await family(school, ["waitlist", "dropped"]);
    const taken = await inSchool((tx) => takenCourses(tx, f.students, ids[`season-${school}`]));
    expect(taken).toEqual([{ studentId: f.students[0], courseId: ids[`course-${school}`], status: "waitlist" }]);
  });

  it("holds the enrollment back until the front desk confirms it, then lists the course once on the record", async () => {
    const f = await family(school, ["active"]);
    expect(await again(f)).toEqual({ ok: false, message: expect.stringMatching(/Inscrire quand même/) });
    const [{ count }] = await admin`SELECT count(*)::int FROM enrollment_course WHERE student_id = ${f.students[0]}`;
    expect(count).toBe(1);

    expect((await again(f, true)).ok).toBe(true);
    const [{ total }] =
      await admin`SELECT count(*)::int AS total FROM enrollment_course WHERE student_id = ${f.students[0]}`;
    expect(total).toBe(2);
    const record = await inSchool((tx) => readPerson(tx, f.students[0]));
    const rows = (record?.courses ?? []).filter((c) => c.id === ids[`course-${school}`]);
    expect(rows.map((c) => c.status)).toEqual(["active"]);
  });

  it("re-enrolls a student who dropped the course without asking", async () => {
    const f = await family(school, ["dropped"]);
    expect((await again(f)).ok).toBe(true);
  });
});

/**
 * A drop-out drafts the payer's season again (#449): every unsent draft of it, a sibling's and
 * another business's included. Last in the file: its last test gives the school a second business.
 */
describe("a drop-out drafting the payer's invoices again (#449)", () => {
  const seasonId = () => ids[`season-${school}`];
  const draft = (payer: string, installmentCount?: number) =>
    inSchool((tx) => draftPayerInvoices(tx, null, payer, seasonId(), installmentCount ? { installmentCount } : {}));
  const draftsOf = (payer: string) =>
    admin`SELECT id, billing_entity_id, total_incl_tax_cents, installment_count FROM invoice
      WHERE payer_id = ${payer} AND status = 'to_send' ORDER BY total_incl_tax_cents`;
  /** A payment allocated to the first installment of `invoiceId` (#254). */
  const paidOn = async (invoiceId: string, payer: string) => {
    const [i] =
      await admin`SELECT id, billing_entity_id, amount_cents FROM installment WHERE invoice_id = ${invoiceId} AND rank = 1`;
    const [p] = await admin`INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, date)
      VALUES (${school}, ${i.billing_entity_id}, ${payer}, ${i.amount_cents}, 'cash', '2027-11-10') RETURNING id`;
    await admin`INSERT INTO payment_allocation (school_id, billing_entity_id, payment_id, installment_id, amount_cents)
      VALUES (${school}, ${i.billing_entity_id}, ${p.id}, ${i.id}, ${i.amount_cents})`;
  };
  /** A sibling's yearly package (300,00 €), on the season's 60-minute course of `entityId`'s. */
  const yearly = (e: string) =>
    admin`UPDATE enrollment SET period = 'year', gross_price_cents = 30000 WHERE id = ${e}`.then(
      () => admin`DELETE FROM enrollment_quarter WHERE enrollment_id = ${e}`,
    );
  const discountOf = async (e: string) =>
    (await admin`SELECT discount_cents FROM enrollment WHERE id = ${e}`)[0].discount_cents as number;

  beforeAll(async () => {
    await admin`INSERT INTO installment_plan_setting (school_id, counts, due_day, rounding_unit_cents)
      VALUES (${school}, '{1,3,10}', 5, 100)`;
  });

  it("keeps the siblings discount raised by a confirmation (#446) on the draft made again", async () => {
    const f = await family(school, ["active", "trial"]);
    const [first, second] = f.enrollments;
    const preview = await inSchool((tx) => confirmationPreview(tx, second));
    const net = preview.status === "ok" ? preview.netPriceCents : null;
    if (net === null) throw new Error("not confirmable");
    expect(await inSchool((tx) => confirmEnrollment(tx, desk, second, net))).toMatchObject({ ok: true });
    // From the 1st child here (`from_rank` 1): the confirmation raised the first one's discount too.
    expect([await discountOf(first), await discountOf(second)]).toEqual([1100, 1100]);
    expect((await draft(f.payer)).ok).toBe(true);
    expect((await draftsOf(f.payer)).map((d) => d.total_incl_tax_cents)).toEqual([59400]);

    expect(await inSchool((tx) => dropEnrollment(tx, desk, first, "2027-11-15"))).toEqual({ ok: true, id: first });
    // 1 quarter kept at 99,00 €, the sibling's 3 quarters with the discount it was saved with.
    expect((await draftsOf(f.payer)).map((d) => d.total_incl_tax_cents)).toEqual([9900 + 3 * 9900]);
    expect(await discountOf(second)).toBe(1100);
  });

  it("the most expensive child dropping (from the 2nd child): the sibling keeps its discount, told only", async () => {
    await admin`UPDATE discount SET from_rank = 2 WHERE season_id = ${seasonId()}`;
    try {
      const f = await family(school, ["active", "active"]);
      const [dearer, cheaper] = f.enrollments;
      await admin`UPDATE enrollment SET manual_price_cents = 15000, price_reason = 'Zz cours en plus' WHERE id = ${dearer}`;
      await admin`UPDATE enrollment SET discount_cents = 1100, discounts = '{fratrie}' WHERE id = ${cheaper}`;
      expect((await draft(f.payer)).ok).toBe(true);
      expect(await inSchool((tx) => leavingImpacts(tx, dearer))).toMatchObject([
        { reference: cheaper, savedDeposit: 1100, recalculatedDiscount: 0 },
      ]);
      expect(await inSchool((tx) => dropEnrollment(tx, desk, dearer, "2027-11-15"))).toEqual({ ok: true, id: dearer });
      expect((await draftsOf(f.payer)).map((d) => d.total_incl_tax_cents)).toEqual([15000 + 3 * 9900]);
      expect(await discountOf(cheaper)).toBe(1100);
    } finally {
      await admin`UPDATE discount SET from_rank = 1 WHERE season_id = ${seasonId()}`;
    }
  });

  it("is refused whole when a payment sits on the draft: nothing changes", async () => {
    const f = await family(school, ["active"]);
    const [e] = f.enrollments;
    expect((await draft(f.payer)).ok).toBe(true);
    const [inv] = await draftsOf(f.payer);
    await paidOn(inv.id, f.payer);
    expect(await inSchool((tx) => dropEnrollment(tx, desk, e, "2027-11-15"))).toEqual({
      ok: false,
      message: dropPaidDraft(null),
    });
    const [row] = await admin`SELECT status, dropped_on FROM enrollment WHERE id = ${e}`;
    expect(row).toEqual({ status: "active", dropped_on: null });
    const [{ kept }] = await admin`SELECT count(*)::int AS kept FROM enrollment_quarter WHERE enrollment_id = ${e}`;
    expect(kept).toBe(3);
    expect((await draftsOf(f.payer)).map((d) => d.id)).toEqual([inv.id]);
    expect(await auditOf(e)).toEqual([]);
  });

  it("leaves a draft the outbox tried alone; the balance counts it at its amount from then on", async () => {
    const f = await family(school, ["active"]);
    const [e] = f.enrollments;
    expect((await draft(f.payer)).ok).toBe(true);
    const [inv] = await draftsOf(f.payer);
    await admin`UPDATE invoice SET attempts = 1 WHERE id = ${inv.id}`;
    expect(await inSchool((tx) => dropEnrollment(tx, desk, e, "2027-11-15"))).toEqual({ ok: true, id: e });
    expect((await admin`SELECT total_incl_tax_cents FROM invoice WHERE id = ${inv.id}`)[0].total_incl_tax_cents).toBe(
      33000,
    );
    // The invoice will be issued as it is: its 3 quarters are due until a credit note, not 1 then 3.
    expect((await inSchool((tx) => balanceOf(tx, f.payer, "2027-11-20")))?.total).toMatchObject({ due: 33000 });
    const [listed] = (await inSchool((tx) => seasonEnrollments(tx, { payerId: f.payer }, seasonId()))).filter(
      (i) => i.id === e,
    );
    expect(listed).toMatchObject({ invoiced: true, invoicedCents: 33000 });
  });

  it.each([
    ["an unsent draft", "to_send", 0, null, 36000],
    ["a draft the outbox tried", "to_send", 1, null, 33000],
    ["an invoice drafted in the tool", "tool_draft", 1, "zz-ref", 33000],
    ["a rejected invoice the tool still holds", "rejected", 10, "zz-ref", 33000],
    ["a rejected invoice the tool never held", "rejected", 10, null, 36000],
    ["a cancelled invoice", "cancelled", 1, "zz-ref", 36000],
  ])(
    "counts %s at the right amount: the invoice's, or the enrollment's price",
    async (_, status, attempts, ref, due) => {
      const f = await family(school, ["active"]);
      expect((await draft(f.payer)).ok).toBe(true);
      const [inv] = await draftsOf(f.payer);
      // Drafted at 3 × 110,00 €; the price moved since (120,00 € a quarter).
      await admin`UPDATE enrollment SET gross_price_cents = 12000 WHERE id = ${f.enrollments[0]}`;
      await admin`UPDATE invoice SET status = ${status}, attempts = ${attempts}, tool_ref = ${ref} WHERE id = ${inv.id}`;
      expect((await inSchool((tx) => balanceOf(tx, f.payer, "2027-11-20")))?.total.due).toBe(due);
    },
  );

  it("a trial dropped before confirmation no longer holds back a refund of what was paid for it", async () => {
    const f = await family(school, ["trial"]);
    await admin`INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, date)
      VALUES (${school}, ${entity}, ${f.payer}, 11000, 'cash', '2027-09-10')`;
    const refundable = async () =>
      (await inSchool((tx) => balanceOf(tx, f.payer, "2027-11-20")))?.refunds.map((r) => r.refundable);
    // On trial, its price is held (#294).
    expect(await refundable()).toEqual([0]);
    await inSchool((tx) => dropEnrollment(tx, desk, f.enrollments[0], "2027-09-20"));
    expect(await refundable()).toEqual([11000]);
  });

  it("keeps the plan chosen when it still fits", async () => {
    const f = await family(school, ["active", "active"]);
    const [quarterly, sibling] = f.enrollments;
    await yearly(sibling);
    expect(await draft(f.payer, 3)).toMatchObject({ ok: true, planned: true });
    expect(await inSchool((tx) => dropEnrollment(tx, desk, quarterly, "2027-11-15"))).toEqual({
      ok: true,
      id: quarterly,
    });
    expect(await draftsOf(f.payer)).toMatchObject([{ total_incl_tax_cents: 11000 + 30000, installment_count: 3 }]);
  });

  it("tells the front desk when the sibling's plan no longer applies, the draft held", async () => {
    const f = await family(school, ["active", "active"]);
    const [quarterly, sibling] = f.enrollments;
    await yearly(sibling);
    expect(await draft(f.payer, 3)).toMatchObject({ ok: true, planned: true });
    // The school no longer offers 3 installments: the plan carried over is dropped.
    await admin`UPDATE installment_plan_setting SET counts = '{1,10}' WHERE school_id = ${school}`;
    try {
      expect(await inSchool((tx) => dropEnrollment(tx, desk, quarterly, "2027-11-15"))).toEqual({
        ok: true,
        id: quarterly,
        notices: [droppedPlanNotice(null, 3)],
      });
      expect(await draftsOf(f.payer)).toMatchObject([{ total_incl_tax_cents: 41000, installment_count: null }]);
    } finally {
      await admin`UPDATE installment_plan_setting SET counts = '{1,3,10}' WHERE school_id = ${school}`;
    }
  });

  it("is refused, naming the business, when another business's draft holds a payment", async () => {
    const [b] =
      await admin`INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, default_vat_treatment_id)
      VALUES (${school}, 'Zz Entreprise B', 'Zz Entreprise B', 'not_applicable',
        (SELECT default_vat_treatment_id FROM billing_entity WHERE id = ${entity})) RETURNING id`;
    const [courseB] =
      await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      SELECT school_id, ${b.id}, season_id, discipline_id, room_id, instructor_id, 3, '18:00', 60 FROM course WHERE id = ${ids[`course-${school}`]}
      RETURNING id`;
    const f = await family(school, ["active", "active"]);
    const [dropped, other] = f.enrollments;
    // The sibling's enrollment belongs to business B (#288).
    await admin`DELETE FROM enrollment_course WHERE enrollment_id = ${other}`;
    await admin`UPDATE enrollment SET billing_entity_id = ${b.id} WHERE id = ${other}`;
    await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id)
      VALUES (${school}, ${b.id}, ${other}, ${f.students[1]}, ${courseB.id})`;
    expect((await draft(f.payer)).ok).toBe(true);
    const drafts = await draftsOf(f.payer);
    expect(drafts.map((d) => d.billing_entity_id).sort()).toEqual([entity, b.id].sort());
    const ofB = drafts.find((d) => d.billing_entity_id === b.id);
    if (!ofB) throw new Error("no draft for business B");
    await paidOn(ofB.id, f.payer);

    expect(await inSchool((tx) => dropEnrollment(tx, desk, dropped, "2027-11-15"))).toEqual({
      ok: false,
      message: dropPaidDraft("Zz Entreprise B"),
    });
    expect((await admin`SELECT status FROM enrollment WHERE id = ${dropped}`)[0].status).toBe("active");
    expect((await draftsOf(f.payer)).map((d) => d.id).sort()).toEqual(drafts.map((d) => d.id).sort());
  });
});
