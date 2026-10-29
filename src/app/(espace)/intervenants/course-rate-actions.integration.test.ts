import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Per-course rates edited from the instructor page (#276): the server action
 * against the real database (app_user, RLS), the session stubbed. Fictitious
 * data deleted at the end; the audit log being immutable, the cleanup disables
 * its trigger for the duration of an administration transaction, as the other
 * tests writing to it do.
 */

type Role = "director" | "front_desk" | "teacher";
const session = vi.hoisted(() => ({ schoolId: "", userId: "", role: "director" as Role }));
vi.mock("@/lib/session", () => ({
  requireRole: async (...roles: Role[]) => {
    // As requireRole: another role is sent away (redirect) before anything is read.
    if (!roles.includes(session.role)) throw new Error("NEXT_REDIRECT /");
    return { schoolId: session.schoolId, userId: session.userId, role: session.role };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Vitest has no `@/` alias: the real modules, by relative path.
vi.mock("@/db", () => import("../../../db/index"));
vi.mock("@/db/courses", () => import("../../../db/courses"));
vi.mock("@/lib/form-errors", () => import("../../../lib/form-errors"));
// Fixed "today" in the current test season, so the past / current split does not depend on the clock.
vi.mock("@/domain/people/age", () => ({ todayInParis: () => "2026-10-29" }));

const { saveCourseRate } = await import("./course-rate-actions");
const { createCourse } = await import("../../../db/courses");
const { withSchool } = await import("../../../db/index");

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const director = `zz-tarifs-direction-${suffix}`;
let school: string;
let hourly: string;
let flat: string;
let current: string;
let past: string;
let flatCourse: string;

const INSTRUCTOR = `(school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents, active)`;

beforeAll(async () => {
  [{ id: school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École', ${`zz-tc-${suffix}`}) RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${director}, 'Zzfaux Test', ${`${director}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${director}, 'director')`;
  const [season] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [pastSeason] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2025-2026', '2025-09-01', '2026-06-30') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Zz Centre', '1 rue Test') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Zz Studio') RETURNING id`;
  const teacher = async (payMode: string, rate: number) =>
    (
      await admin.unsafe(
        `INSERT INTO instructor ${INSTRUCTOR} VALUES ($1, 'Zzfaux', 'Prof', 'employee', 'not_applicable', $2, $3, true)
         RETURNING id`,
        [school, payMode, rate],
      )
    )[0].id as string;
  hourly = await teacher("hourly", 4000);
  flat = await teacher("monthly_flat", 120000);
  const create = async (seasonId: string, instructorId: string, instructorRate: number | null) => {
    const r = await withSchool(school, (tx) =>
      createCourse(tx, seasonId, {
        discipline: { name: "Zz Jazz" },
        room: { id: room.id },
        instructorId,
        type: "group",
        recurrence: "weekly",
        weekday: 2,
        startDate: null,
        endDate: null,
        dates: [],
        startTime: "18:00",
        durationMinutes: 60,
        ageMin: null,
        ageMax: null,
        level: null,
        maxCapacity: null,
        instructorRate,
      }),
    );
    if (!r.ok) throw new Error(r.message);
    return r.id;
  };
  current = await create(season.id, hourly, null);
  past = await create(pastSeason.id, hourly, 3500);
  flatCourse = await create(season.id, flat, null);
  session.schoolId = school;
  session.userId = director;
});

beforeEach(() => {
  session.role = "director";
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id = ${school}`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of ["lesson", "course_date", "course", "instructor", "room", "site", "discipline", "season", "member"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  await admin`DELETE FROM "user" WHERE id = ${director}`;
  await admin`DELETE FROM school WHERE id = ${school}`;
  await admin.end();
});

const stored = async (id: string) =>
  (
    await admin`SELECT instructor_rate_cents AS cents, instructor_rate_pay_mode AS unit FROM course WHERE id = ${id}`
  ).map((r) => ({ cents: r.cents as number | null, unit: r.unit as string | null }))[0];
const audit = (id: string) =>
  admin`SELECT action, before, after, actor IS NOT NULL AS has_actor FROM audit_log
    WHERE school_id = ${school} AND row_id = ${id} ORDER BY id`;

describe("saveCourseRate (#276)", () => {
  it("sets a rate in the instructor's unit, then clears it, each change in the audit log", async () => {
    expect(await saveCourseRate(hourly, current, { rate: "45,50", unit: "hourly" })).toEqual({
      ok: true,
      rate: { cents: 4550, payMode: "hourly" },
    });
    expect(await stored(current)).toEqual({ cents: 4550, unit: "hourly" });

    expect(await saveCourseRate(hourly, current, { rate: " ", unit: "hourly" })).toEqual({ ok: true, rate: null });
    expect(await stored(current)).toEqual({ cents: null, unit: null });

    const none = { instructorId: hourly, instructorRateCents: null, instructorRatePayMode: null };
    const set = { instructorId: hourly, instructorRateCents: 4550, instructorRatePayMode: "hourly" };
    expect((await audit(current)).map((r) => ({ ...r }))).toEqual([
      { action: "update", before: none, after: set, has_actor: true },
      { action: "update", before: set, after: none, has_actor: true },
    ]);
  });

  it("writes nothing to the audit log when the rate did not change", async () => {
    const before = (await audit(current)).length;
    expect(await saveCourseRate(hourly, current, { rate: "", unit: "hourly" })).toEqual({ ok: true, rate: null });
    expect((await audit(current)).length).toBe(before);
  });

  it("refuses an amount that is not in euros, with the field's message", async () => {
    expect(await saveCourseRate(hourly, current, { rate: "abc", unit: "hourly" })).toEqual({
      ok: false,
      message: "Montant en euros, par exemple 35 ou 35,50",
    });
    expect(await saveCourseRate(hourly, current, { rate: "40" })).toEqual({ ok: false, message: "Saisie invalide." });
    expect(await stored(current)).toEqual({ cents: null, unit: null });
  });

  it("refuses the front desk and teachers before reading anything", async () => {
    for (const role of ["front_desk", "teacher"] as const) {
      session.role = role;
      await expect(saveCourseRate(hourly, current, { rate: "50", unit: "hourly" })).rejects.toThrow("NEXT_REDIRECT");
    }
    expect(await stored(current)).toEqual({ cents: null, unit: null });
  });

  it("refuses a rate per course for a monthly flat instructor (#192)", async () => {
    expect(await saveCourseRate(flat, flatCourse, { rate: "30", unit: "monthly_flat" })).toEqual({
      ok: false,
      message: "Pas de tarif par cours pour un forfait mensuel pour l’instant (règle en attente).",
    });
    expect(await stored(flatCourse)).toEqual({ cents: null, unit: null });
  });

  it("refuses an amount typed in a pay mode the instructor is no longer paid in (#268)", async () => {
    expect(await saveCourseRate(hourly, current, { rate: "30", unit: "per_lesson" })).toEqual({
      ok: false,
      message:
        "Le mode de rémunération de cet intervenant a changé : rechargez la page pour saisir le tarif dans la bonne unité.",
    });
    expect(await stored(current)).toEqual({ cents: null, unit: null });
  });

  it("keeps a past season's rate as history (#192 Q5)", async () => {
    expect(await saveCourseRate(hourly, past, { rate: "50", unit: "hourly" })).toEqual({
      ok: false,
      message: "La saison de ce cours est terminée : son tarif est gardé tel quel.",
    });
    expect(await stored(past)).toEqual({ cents: 3500, unit: "hourly" });
  });

  it("refuses a course taught by another instructor, and unknown ids", async () => {
    expect(await saveCourseRate(flat, current, { rate: "", unit: "monthly_flat" })).toEqual({
      ok: false,
      message: "Ce cours est maintenant donné par un autre intervenant : rechargez la page.",
    });
    expect(await saveCourseRate(hourly, "x", { rate: "50", unit: "hourly" })).toEqual({
      ok: false,
      message: "Ce cours n’existe plus.",
    });
    expect(await saveCourseRate("x", current, { rate: "50", unit: "hourly" })).toEqual({
      ok: false,
      message: "Cet intervenant n’existe plus.",
    });
  });

  it("sees no course of another school", async () => {
    session.schoolId = "00000000-0000-4000-8000-000000000000";
    try {
      expect(await saveCourseRate(hourly, current, { rate: "50", unit: "hourly" })).toEqual({
        ok: false,
        message: "Cet intervenant n’existe plus.",
      });
    } finally {
      session.schoolId = school;
    }
    expect(await stored(current)).toEqual({ cents: null, unit: null });
  });
});
