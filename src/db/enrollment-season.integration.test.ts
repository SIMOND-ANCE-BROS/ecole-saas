import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { enrollmentPreview, saveEnrollment } from "./enrollments";
import { enrollableSeason } from "./schedule";
import { hasTariffGrid } from "./tariffs";
import { schoolWithDefaultEntity } from "./billing-entity.integration-helpers";
import { withDefaultQuarters } from "./season-quarters.integration-helpers";

/**
 * Enrolling in the season a record shows (#376), run as the application (app_user, RLS):
 * the current season and later ones, never a past season nor another school's.
 * Fictitious data deleted at the end.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const ids = {} as Record<string, string>;
const frontDesk = `sub-accueil-es-${suffix}`;
// In June, after the gala: 2026-2027 is still current, re-enrollments for 2027-2028 start.
const TODAY = "2027-06-20";

beforeAll(async () => {
  [{ id: ids.school }] = await schoolWithDefaultEntity(admin, "École ES", `es-${suffix}`);
  [{ id: ids.otherSchool }] = await schoolWithDefaultEntity(admin, "École ES autre", `es2-${suffix}`);
  const e = ids.school;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${frontDesk}, 'Zz Accueil', ${`${frontDesk}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${e}, ${frontDesk}, 'front_desk')`;
  const season = async (school: string, label: string, start: string, end: string) => {
    const [{ id }] =
      await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${school}, ${label}, ${start}, ${end}) RETURNING id`;
    await withDefaultQuarters(admin, id);
    return id as string;
  };
  ids.past = await season(e, "Zz 2025-2026", "2025-09-01", "2026-06-30");
  ids.current = await season(e, "Zz 2026-2027", "2026-09-01", "2027-06-30");
  ids.next = await season(e, "Zz 2027-2028", "2027-09-01", "2028-06-30");
  ids.foreign = await season(ids.otherSchool, "Zz 2027-2028", "2027-09-01", "2028-06-30");
  // The next season has its grid; the current one has none (#376 Q2).
  await admin`INSERT INTO tariff (school_id, season_id, audience, period, combination, price_cents)
    VALUES (${e}, ${ids.next}, 'child', 'quarter', '{60}'::smallint[], 12000)`;
  const [site] = await admin`INSERT INTO site (school_id, name, address) VALUES (${e}, 'Zz Site', 'Zz') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${e}, ${site.id}, 'Zz Salle') RETURNING id`;
  const [teacher] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${e}, 'Zz Prof', 'Zz', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  const [jazz] = await admin`INSERT INTO discipline (school_id, name) VALUES (${e}, 'Zz Jazz') RETURNING id`;
  [{ id: ids.nextCourse }] =
    await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${e}, (SELECT id FROM billing_entity WHERE school_id = ${e} AND is_default), ${ids.next}, ${jazz.id}, ${room.id}, ${teacher.id}, 1, '17:00', 60) RETURNING id`;
  [{ id: ids.currentCourse }] =
    await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${e}, (SELECT id FROM billing_entity WHERE school_id = ${e} AND is_default), ${ids.current}, ${jazz.id}, ${room.id}, ${teacher.id}, 2, '17:00', 60) RETURNING id`;
  // Siblings discount of the next season only: a sibling enrolled in the current one never counts.
  await admin`INSERT INTO discount (school_id, season_id, code, rate_bps, min_students, audiences, combinable_with_multi_discipline)
    VALUES (${e}, ${ids.next}, 'fratrie', 1000, 2, '{child}', false)`;
  [{ id: ids.entity }] = await admin`SELECT id FROM billing_entity WHERE school_id = ${e} AND is_default`;
  [{ id: ids.payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${e}, 'Zz Famille', 'Zz') RETURNING id`;
  [{ id: ids.student }] =
    await admin`INSERT INTO person (school_id, last_name, first_name, is_student) VALUES (${e}, 'Zz Famille', 'Zoé', true) RETURNING id`;
  [{ id: ids.brother }] =
    await admin`INSERT INTO person (school_id, last_name, first_name, is_student) VALUES (${e}, 'Zz Famille', 'Noé', true) RETURNING id`;
  for (const student of [ids.student, ids.brother])
    await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for)
      VALUES (${e}, ${ids.payer}, ${student}, 'legal_guardian', true)`;
});

afterAll(async () => {
  // The audit log is append-only: its trigger is disabled for the cleanup only.
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id = ${ids.school}`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const school of [ids.school, ids.otherSchool]) {
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
      "tariff",
      "discount",
      "season_quarter",
      "season",
      "member",
    ]) {
      await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
    }
    await admin`DELETE FROM school WHERE id = ${school}`;
  }
  await admin`DELETE FROM "user" WHERE id = ${frontDesk}`;
  await admin.end();
});

const check = (seasonId: unknown) => withSchool(ids.school, (tx) => enrollableSeason(tx, seasonId, TODAY));

describe("enrollableSeason (#376)", () => {
  it("accepts the current season", async () => {
    expect(await check(ids.current)).toMatchObject({ ok: true, season: { id: ids.current } });
  });

  it("accepts the next season, with the current one to come back to the record", async () => {
    expect(await check(ids.next)).toMatchObject({
      ok: true,
      season: { id: ids.next, label: "Zz 2027-2028" },
      current: { id: ids.current },
    });
  });

  it("refuses a past season, naming it", async () => {
    expect(await check(ids.past)).toEqual({
      ok: false,
      message:
        "La saison Zz 2025-2026 est terminée : les inscriptions se font en Zz 2026-2027 ou dans une saison suivante.",
    });
  });

  it("refuses another school's season, as an unknown or malformed id", async () => {
    for (const asked of [ids.foreign, "00000000-0000-4000-8000-000000000000", "pas-un-id", undefined]) {
      expect(await check(asked)).toEqual({ ok: false, message: "Cette saison n’existe pas." });
    }
  });
});

describe("Enrolling in the next season (#376)", () => {
  const entry = {
    studentIds: [] as string[],
    audience: "child" as const,
    period: "quarter" as const,
    courseIds: [] as string[],
  };

  it("prices it on the next season's grid and covers its every quarter", async () => {
    const p = await withSchool(ids.school, (tx) =>
      enrollmentPreview(
        tx,
        ids.payer,
        ids.next,
        { ...entry, studentIds: [ids.student], courseIds: [ids.nextCourse] },
        TODAY,
      ),
    );
    if (p.status !== "ok") throw new Error(p.message);
    expect(p.newEnrollments[0].price).toMatchObject({ status: "ok", netPriceCents: 12000 });
    expect(p.quarters).toHaveLength(3);
  });

  it("saves it in the next season, dated today", async () => {
    const r = await withSchool(ids.school, (tx) =>
      saveEnrollment(
        tx,
        frontDesk,
        ids.payer,
        ids.next,
        { ...entry, studentIds: [ids.student], courseIds: [ids.nextCourse] },
        TODAY,
      ),
    );
    if (!r.ok) throw new Error(r.message);
    const [row] = await admin`SELECT season_id, to_char(enrolled_on, 'YYYY-MM-DD') AS on, net_price_cents,
      (SELECT count(*)::int FROM enrollment_quarter q WHERE q.enrollment_id = e.id) AS quarters
      FROM enrollment e WHERE id = ${r.id}`;
    expect(row).toEqual({ season_id: ids.next, on: TODAY, net_price_cents: 12000, quarters: 3 });
  });
});

describe("Seasons kept apart (#376)", () => {
  const child = (studentId: string, courseId: string) => ({
    studentIds: [studentId],
    audience: "child" as const,
    period: "quarter" as const,
    courseIds: [courseId],
  });

  it("prices a season without a grid only by a typed price, with its reason, over every remaining quarter", async () => {
    const refused = await withSchool(ids.school, (tx) =>
      saveEnrollment(tx, frontDesk, ids.payer, ids.current, child(ids.brother, ids.currentCourse), TODAY),
    );
    expect(refused.ok).toBe(false);
    const r = await withSchool(ids.school, (tx) =>
      saveEnrollment(
        tx,
        frontDesk,
        ids.payer,
        ids.current,
        {
          ...child(ids.brother, ids.currentCourse),
          manualPrices: [{ billingEntityId: ids.entity, priceCents: 9900, reason: "Zz grille à venir" }],
        },
        TODAY,
      ),
    );
    if (!r.ok) throw new Error(r.message);
    const [row] = await admin`SELECT manual_price_cents, tariff_id, price_reason,
      (SELECT count(*)::int FROM enrollment_quarter q WHERE q.enrollment_id = e.id) AS quarters
      FROM enrollment e WHERE id = ${r.id}`;
    // On 20 June only the season's last quarter (April–June) is still to come.
    expect(row).toEqual({ manual_price_cents: 9900, tariff_id: null, price_reason: "Zz grille à venir", quarters: 1 });
  });

  it("gives the siblings discount from the next season's enrollments only", async () => {
    // Noé is enrolled in the current season (above), Zoé in the next one: in the next season,
    // Noé is a second child of the payer only through Zoé.
    const p = await withSchool(ids.school, (tx) =>
      enrollmentPreview(tx, ids.payer, ids.next, child(ids.brother, ids.nextCourse), TODAY),
    );
    if (p.status !== "ok") throw new Error(p.message);
    expect(p.newEnrollments[0].price).toMatchObject({ status: "ok", grossPriceCents: 12000, discountCents: 1200 });
    const [zoe] = await admin`SELECT discount_cents FROM enrollment
      WHERE season_id = ${ids.next} AND school_id = ${ids.school}
        AND id IN (SELECT enrollment_id FROM enrollment_course WHERE student_id = ${ids.student})`;
    expect(zoe.discount_cents).toBe(0);
  });
});

describe("hasTariffGrid (#376 Q2)", () => {
  it("tells a season with a grid from one without, never reading another school's", async () => {
    const read = (seasonId: string) => withSchool(ids.school, (tx) => hasTariffGrid(tx, seasonId));
    expect(await read(ids.next)).toBe(true);
    expect(await read(ids.current)).toBe(false);
    expect(await withSchool(ids.otherSchool, (tx) => hasTariffGrid(tx, ids.next))).toBe(false);
  });
});
