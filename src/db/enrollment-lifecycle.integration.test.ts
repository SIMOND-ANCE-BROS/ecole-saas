import postgres from "postgres";
import { withDefaultQuarters } from "./season-quarters.integration-helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import {
  cancelEnrollment,
  confirmEnrollment,
  confirmationPreview,
  dropEnrollment,
  leavingImpacts,
  seasonEnrollments,
} from "./enrollments";
import { readAttendance } from "./lessons";
import { enrolledInCourse } from "./schedule";
import { balanceOf } from "./payments";
import { overlapping } from "./overlap.integration-helpers";
import { defaultEntityFor } from "./billing-entity.integration-helpers";

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
    await t`DELETE FROM payment WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE payment ENABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of [
    "invoice_line",
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
    // The sibling saved before is never re-priced on its own (Q2).
    expect((await admin`SELECT discount_cents FROM enrollment WHERE id = ${f.enrollments[0]}`)[0].discount_cents).toBe(
      0,
    );
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

  it("a drop-out stays due on the payer's balance (the school neither carries over nor refunds)", async () => {
    const f = await family(school, ["active"]);
    await inSchool((tx) => dropEnrollment(tx, desk, f.enrollments[0], "2027-11-15"));
    // 110,00 € a quarter, enrolled for the season's three quarters (#291).
    expect((await inSchool((tx) => balanceOf(tx, f.payer, "2027-11-20")))?.total).toMatchObject({
      due: 33000,
      outsideCalculation: {},
    });
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
    const [inv] =
      await admin`INSERT INTO invoice (school_id, billing_entity_id, payer_id) VALUES (${school}, ${entity}, ${f.payer}) RETURNING id`;
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
