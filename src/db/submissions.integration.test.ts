import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCourse, type CourseInput } from "./courses";
import { saveEnrollment } from "./enrollments";
import { withSchool } from "./index";
import { syncLessons } from "./lessons";
import { overlapping } from "./overlap.integration-helpers";
import { defaultEntityFor } from "./billing-entity.integration-helpers";
import { collect } from "./payments";
import { KEY_REUSED, once, requestHash, storedCourse, storedEnrollment, storedPayments } from "./submissions";

/**
 * Creations made safe to retry (#260), as the application runs them (app_user,
 * RLS). Fictitious data deleted at the end; payments and the audit log being
 * immutable, the cleanup disables their triggers inside an administration
 * transaction, as the payments tests do.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const frontDesk = `sub-accueil-${suffix}`;
const TODAY = "2026-10-21";
const ids = {} as Record<string, string>;
let courseInput: CourseInput;

beforeAll(async () => {
  [{ id: ids.school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École A', ${`sa-${suffix}`}) RETURNING id`;
  [{ id: ids.otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École B', ${`sb-${suffix}`}) RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${frontDesk}, 'Zz Accueil', ${`${frontDesk}@exemple.test`})`;
  for (const s of [ids.school, ids.otherSchool]) {
    await admin`INSERT INTO member (school_id, user_id, role) VALUES (${s}, ${frontDesk}, 'front_desk')`;
    await defaultEntityFor(admin, s);
  }
  const e = ids.school;
  [{ id: ids.payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${e}, 'Zzpayeur', 'Sophie') RETURNING id`;
  [{ id: ids.otherPayer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${ids.otherSchool}, 'Zzailleurs', 'Paul') RETURNING id`;
  [{ id: ids.student }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${e}, 'Zzpayeur', 'Zoé') RETURNING id`;
  await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for)
    VALUES (${e}, ${ids.payer}, ${ids.student}, 'legal_guardian', true)`;
  [{ id: ids.season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${e}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  await admin`INSERT INTO tariff (school_id, season_id, audience, period, combination, price_cents)
    VALUES (${e}, ${ids.season}, 'child', 'quarter', '{60}'::smallint[], 11000)`;
  const [site] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${e}, 'Zz Site', '1 rue Test') RETURNING id`;
  [{ id: ids.room }] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${e}, ${site.id}, 'Zz Salle') RETURNING id`;
  [{ id: ids.teacher }] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${e}, 'Zzprof', 'Camille', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  const [jazz] = await admin`INSERT INTO discipline (school_id, name) VALUES (${e}, 'Zz Jazz') RETURNING id`;
  [{ id: ids.course }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${e}, ${ids.season}, ${jazz.id}, ${ids.room}, ${ids.teacher}, 1, '17:00', 60) RETURNING id`;
  courseInput = {
    discipline: { name: "Zz Classique" },
    room: { id: ids.room },
    instructorId: ids.teacher,
    type: "group",
    recurrence: "weekly",
    weekday: 4,
    startDate: null,
    endDate: null,
    dates: [],
    startTime: "18:00",
    durationMinutes: 60,
    ageMin: null,
    ageMax: null,
    level: null,
    maxCapacity: null,
    instructorRate: null,
  };
});

afterAll(async () => {
  const schools = [ids.school, ids.otherSchool];
  await admin.begin(async (t) => {
    await t`ALTER TABLE payment DISABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN ${t(schools)}`;
    await t`DELETE FROM payment WHERE school_id IN ${t(schools)}`;
    await t`ALTER TABLE payment ENABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of [
    "submission",
    "lesson",
    "course_date",
    "enrollment_course",
    "enrollment",
    "course",
    "discipline",
    "instructor",
    "room",
    "site",
    "tariff",
    "season",
    "relationship",
    "person",
    "member",
  ]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, schools);
  }
  await admin`DELETE FROM "user" WHERE id = ${frontDesk}`;
  await admin`DELETE FROM school WHERE id IN ${admin(schools)}`;
  await admin.end();
});

const cash = (amountCents: number) => [
  { method: "cash" as const, amountCents, date: TODAY, reference: null, issuer: null, plannedPayment: null },
];

/** A payment submission, as `collectPayments` runs it. */
const pay = (key: string, amountCents: number, school = ids.school, payer = ids.payer) =>
  withSchool(school, (tx) =>
    once(tx, "payment", key, { payerId: payer, entry: cash(amountCents) }, storedPayments, () =>
      collect(tx, frontDesk, payer, cash(amountCents)),
    ),
  );

const paymentsOf = async (payer: string) =>
  (await admin`SELECT count(*)::int AS n FROM payment WHERE payer_id = ${payer}`)[0].n as number;

describe("once: new payments", () => {
  it("records nothing twice for the same key, and gives the first result back", async () => {
    const key = randomUUID();
    const before = await paymentsOf(ids.payer);
    const first = await pay(key, 2000);
    const again = await pay(key, 2000);
    expect(first.ok).toBe(true);
    expect(again).toEqual(first);
    expect(await paymentsOf(ids.payer)).toBe(before + 1);
  });

  it("refuses the same key sent with other values, without recording them", async () => {
    const key = randomUUID();
    await pay(key, 3000);
    const before = await paymentsOf(ids.payer);
    expect(await pay(key, 3100)).toEqual({ ok: false, message: KEY_REUSED });
    expect(await paymentsOf(ids.payer)).toBe(before);
  });

  it("records two payments for two keys", async () => {
    const before = await paymentsOf(ids.payer);
    await pay(randomUUID(), 1000);
    await pay(randomUUID(), 1000);
    expect(await paymentsOf(ids.payer)).toBe(before + 2);
  });

  it("frees the key after a refusal, so that the corrected entry can be sent with it", async () => {
    const key = randomUUID();
    const refused = await pay(key, 0);
    expect(refused.ok).toBe(false);
    const before = await paymentsOf(ids.payer);
    expect((await pay(key, 1500)).ok).toBe(true);
    expect(await paymentsOf(ids.payer)).toBe(before + 1);
  });

  it("records once when the same key arrives twice at the same time", async () => {
    const key = randomUUID();
    const before = await paymentsOf(ids.payer);
    const [first, second] = await overlapping(
      admin,
      (hold) =>
        withSchool(ids.school, async (tx) => {
          const r = await once(tx, "payment", key, { payerId: ids.payer, entry: cash(4000) }, storedPayments, () =>
            collect(tx, frontDesk, ids.payer, cash(4000)),
          );
          await hold();
          return r;
        }),
      () => pay(key, 4000),
    );
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(await paymentsOf(ids.payer)).toBe(before + 1);
  });

  it("keeps each school's keys apart (RLS)", async () => {
    const key = randomUUID();
    const before = await paymentsOf(ids.otherPayer);
    expect((await pay(key, 500)).ok).toBe(true);
    expect((await pay(key, 500, ids.otherSchool, ids.otherPayer)).ok).toBe(true);
    expect(await paymentsOf(ids.otherPayer)).toBe(before + 1);
    const seen = await withSchool(ids.otherSchool, (tx) =>
      tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM submission WHERE school_id <> current_setting('app.school_id')::uuid`,
      ),
    );
    expect(seen[0].n).toBe(0);
  });
});

describe("once: enrollments and courses", () => {
  it("enrolls once for the same key", async () => {
    const key = randomUUID();
    const entry = {
      studentIds: [ids.student],
      audience: "child" as const,
      period: "quarter" as const,
      courseIds: [ids.course],
    };
    const run = () =>
      withSchool(ids.school, (tx) =>
        once(tx, "enrollment", key, { payerId: ids.payer, ...entry }, storedEnrollment, () =>
          saveEnrollment(tx, ids.payer, ids.season, entry),
        ),
      );
    const first = await run();
    expect(first.ok).toBe(true);
    expect(await run()).toEqual(first);
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM enrollment WHERE payer_id = ${ids.payer}`;
    expect(n).toBe(1);
  });

  it("creates a course and its lessons once for the same key", async () => {
    const key = randomUUID();
    const run = () =>
      withSchool(ids.school, (tx) =>
        once(tx, "course", key, { entry: courseInput, seasonId: ids.season }, storedCourse, async () => {
          const r = await createCourse(tx, ids.season, courseInput);
          if (r.ok) await syncLessons(tx, ids.season, TODAY);
          return r;
        }),
      );
    const first = await run();
    if (!first.ok) throw new Error(first.message);
    const lessons = async () =>
      (await admin`SELECT count(*)::int AS n FROM lesson WHERE course_id = ${first.id}`)[0].n as number;
    const lessonsAfterFirst = await lessons();
    expect(lessonsAfterFirst).toBeGreaterThan(0);
    expect(await run()).toEqual(first);
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM course c JOIN discipline d ON d.id = c.discipline_id
      WHERE c.school_id = ${ids.school} AND d.name = 'Zz Classique'`;
    expect(n).toBe(1);
    expect(await lessons()).toBe(lessonsAfterFirst);
  });

  it("refuses a key already used by another kind of submission", async () => {
    const key = randomUUID();
    await pay(key, 700);
    const r = await withSchool(ids.school, (tx) =>
      once(tx, "enrollment", key, { payerId: ids.payer }, storedEnrollment, async () => ({
        ok: true as const,
        id: randomUUID(),
      })),
    );
    expect(r).toEqual({ ok: false, message: KEY_REUSED });
  });
});

describe("once: failures free the key", () => {
  const concurrentAfter = <A>(key: string, first: (hold: () => Promise<void>) => Promise<A>) =>
    overlapping(admin, first, () => pay(key, 4500));

  it("records once when the first of two concurrent attempts is rolled back", async () => {
    const key = randomUUID();
    const before = await paymentsOf(ids.payer);
    const [first, second] = await concurrentAfter(key, (hold) =>
      withSchool(ids.school, async (tx) => {
        await once(tx, "payment", key, { payerId: ids.payer, entry: cash(4500) }, storedPayments, () =>
          collect(tx, frontDesk, ids.payer, cash(4500)),
        );
        await hold();
        throw new Error("rolled back");
      }).catch((e: Error) => e.message),
    );
    expect(first).toBe("rolled back");
    expect(second.ok).toBe(true);
    expect(await paymentsOf(ids.payer)).toBe(before + 1);
  });

  it("records once when the first of two concurrent attempts is refused", async () => {
    const key = randomUUID();
    const before = await paymentsOf(ids.payer);
    const [first, second] = await concurrentAfter(key, (hold) =>
      withSchool(ids.school, async (tx) => {
        const r = await once(tx, "payment", key, { payerId: ids.payer, entry: cash(0) }, storedPayments, () =>
          collect(tx, frontDesk, ids.payer, cash(0)),
        );
        await hold();
        return r;
      }),
    );
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(await paymentsOf(ids.payer)).toBe(before + 1);
  });

  it("lets the same key succeed after a creation that threw", async () => {
    const key = randomUUID();
    await expect(
      withSchool(ids.school, (tx) =>
        once(tx, "payment", key, { payerId: ids.payer, entry: cash(800) }, storedPayments, () => {
          throw new Error("boom");
        }),
      ),
    ).rejects.toThrow("boom");
    const before = await paymentsOf(ids.payer);
    expect((await pay(key, 800)).ok).toBe(true);
    expect(await paymentsOf(ids.payer)).toBe(before + 1);
  });

  it("rolls back what a refused creation wrote before refusing", async () => {
    const key = randomUUID();
    const name = `Zz Orpheline ${suffix}`;
    const r = await withSchool(ids.school, (tx) =>
      once(tx, "course", key, { name }, storedCourse, async () => {
        await tx.execute(sql`INSERT INTO discipline (school_id, name) VALUES (${ids.school}, ${name})`);
        return { ok: false as const, message: "Salle introuvable." };
      }),
    );
    expect(r).toEqual({ ok: false, message: "Salle introuvable." });
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM discipline WHERE name = ${name}`;
    expect(n).toBe(0);
    const [{ k }] = await admin`SELECT count(*)::int AS k FROM submission WHERE key = ${key}`;
    expect(k).toBe(0);
  });

  it("gives the same fingerprint whatever the order of the keys", () => {
    expect(requestHash({ a: 1, b: [{ y: 2, x: null }] })).toBe(requestHash({ b: [{ x: null, y: 2 }], a: 1 }));
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
    expect(requestHash({ a: 1 })).toHaveLength(64);
  });
});
