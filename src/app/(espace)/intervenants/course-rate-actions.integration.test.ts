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
/** Fixed "today" in the current test season, so the past / current split does not depend on the clock. */
const TODAY = "2026-10-29";
const session = vi.hoisted(() => ({ schoolId: "", userId: "", role: "director" as Role, today: "" }));
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
vi.mock("@/domain/people/age", () => ({ todayInParis: () => session.today }));

const { saveCourseRate } = await import("./course-rate-actions");
const { createCourse, courseRate, setCourseRate, updateCourse } = await import("../../../db/courses");
type CourseInput = import("../../../db/courses").CourseInput;
const { withSchool } = await import("../../../db/index");
const { overlapping } = await import("../../../db/overlap.integration-helpers");

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

/** Typographic space before a French « : ». */
const NBSP = " ";
const suffix = Math.random().toString(36).slice(2, 8);
const director = `zz-tarifs-direction-${suffix}`;
let school: string;
let season: string;
let hourly: string;
let flat: string;
let current: string;
let past: string;
let flatCourse: string;
let base: CourseInput;

const INSTRUCTOR = `(school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents, active)`;

/** A weekly course of this school, saved as the course form does. */
const create = async (seasonId: string, instructorId: string, instructorRate: number | null, weekday = 2) => {
  const r = await withSchool(school, (tx) =>
    createCourse(tx, seasonId, { ...base, instructorId, weekday, instructorRate }),
  );
  if (!r.ok) throw new Error(r.message);
  return r.id;
};

beforeAll(async () => {
  [{ id: school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École', ${`zz-tc-${suffix}`}) RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${director}, 'Zzfaux Test', ${`${director}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${director}, 'director')`;
  [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
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
  base = {
    discipline: { name: "Zz Jazz" },
    room: { id: room.id },
    instructorId: hourly,
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
    instructorRate: null,
  };
  session.schoolId = school;
  session.userId = director;
  current = await create(season, hourly, null);
  past = await create(pastSeason.id, hourly, 3500);
  flatCourse = await create(season, flat, null);
});

beforeEach(() => {
  session.role = "director";
  session.today = TODAY;
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
/** A rate as an older form or pay mode left it, written directly. */
const seed = (id: string, cents: number, unit: string) =>
  admin`UPDATE course SET instructor_rate_cents = ${cents}, instructor_rate_pay_mode = ${unit}::pay_mode WHERE id = ${id}`;
const audit = (id: string) =>
  admin`SELECT action, before, after, actor IS NOT NULL AS has_actor FROM audit_log
    WHERE school_id = ${school} AND row_id = ${id} ORDER BY id`;
const state = (instructorId: string, cents: number | null, unit: string | null) => ({
  instructorId,
  instructorRateCents: cents,
  instructorRatePayMode: unit,
});

describe("saveCourseRate (#276)", () => {
  it("sets a rate in the instructor's unit, then clears it, each change in the audit log", async () => {
    expect(await saveCourseRate(hourly, current, { rate: "45,50", unit: "hourly" })).toEqual({
      ok: true,
      rate: { cents: 4550, payMode: "hourly" },
    });
    expect(await stored(current)).toEqual({ cents: 4550, unit: "hourly" });

    expect(await saveCourseRate(hourly, current, { rate: " ", unit: "hourly" })).toEqual({ ok: true, rate: null });
    expect(await stored(current)).toEqual({ cents: null, unit: null });

    const none = state(hourly, null, null);
    const set = state(hourly, 4550, "hourly");
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
    expect(await saveCourseRate(hourly, current, { rate: "40", unit: "yearly" })).toEqual({
      ok: false,
      message: "Saisie invalide.",
    });
    expect(await stored(current)).toEqual({ cents: null, unit: null });
  });

  it("takes amounts from 0 to 100 000 €, a dot or a comma, and refuses one cent more", async () => {
    const id = await create(season, hourly, null, 4);
    for (const [typed, cents] of [
      ["0", 0],
      ["0,01", 1],
      ["45.5", 4550],
      ["100000", 100_000_00],
    ] as const) {
      expect(await saveCourseRate(hourly, id, { rate: typed, unit: "hourly" })).toEqual({
        ok: true,
        rate: { cents, payMode: "hourly" },
      });
      expect(await stored(id)).toEqual({ cents, unit: "hourly" });
    }
    expect(await saveCourseRate(hourly, id, { rate: "100000,01", unit: "hourly" })).toEqual({
      ok: false,
      message: "Montant en euros, par exemple 35 ou 35,50",
    });
    expect(await stored(id)).toEqual({ cents: 100_000_00, unit: "hourly" });
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

  it("lets a monthly flat instructor's stored rate be cleared, as the course form does (#192 Q2)", async () => {
    await seed(flatCourse, 3000, "monthly_flat");
    expect(await saveCourseRate(flat, flatCourse, { rate: "", unit: "monthly_flat" })).toEqual({
      ok: true,
      rate: null,
    });
    expect(await stored(flatCourse)).toEqual({ cents: null, unit: null });
    expect((await audit(flatCourse)).map((r) => ({ ...r }))).toEqual([
      {
        action: "update",
        before: state(flat, 3000, "monthly_flat"),
        after: state(flat, null, null),
        has_actor: true,
      },
    ]);
  });

  it("refuses an amount typed in a pay mode the instructor is no longer paid in (#268)", async () => {
    expect(await saveCourseRate(hourly, current, { rate: "30", unit: "per_lesson" })).toEqual({
      ok: false,
      message:
        "Le mode de rémunération de cet intervenant a changé : rechargez la page pour saisir le tarif dans la bonne unité.",
    });
    expect(await stored(current)).toEqual({ cents: null, unit: null });
  });

  it("clears an older unit's rate of the current season, or stores a new amount in the current unit (#268)", async () => {
    const cleared = await create(season, hourly, null, 5);
    const retyped = await create(season, hourly, null, 6);
    await seed(cleared, 3000, "per_lesson");
    await seed(retyped, 3000, "per_lesson");

    // The page's field starts empty for it: empty is a change, it clears the rate.
    expect(await saveCourseRate(hourly, cleared, { rate: "", unit: "hourly" })).toEqual({ ok: true, rate: null });
    expect(await stored(cleared)).toEqual({ cents: null, unit: null });
    expect((await audit(cleared)).map((r) => ({ ...r }))).toEqual([
      {
        action: "update",
        before: state(hourly, 3000, "per_lesson"),
        after: state(hourly, null, null),
        has_actor: true,
      },
    ]);

    // The same amount typed in the unit shown (the current one): converted on purpose, and logged.
    expect(await saveCourseRate(hourly, retyped, { rate: "30", unit: "hourly" })).toEqual({
      ok: true,
      rate: { cents: 3000, payMode: "hourly" },
    });
    expect(await stored(retyped)).toEqual({ cents: 3000, unit: "hourly" });
    expect((await audit(retyped)).map((r) => ({ ...r }))).toEqual([
      {
        action: "update",
        before: state(hourly, 3000, "per_lesson"),
        after: state(hourly, 3000, "hourly"),
        has_actor: true,
      },
    ]);
  });

  it("from a page opened before a pay mode change, keeps the untouched rate sent back, refuses a new amount (#268)", async () => {
    // The page showed « 30 € / heure »; the instructor is now paid per lesson.
    const id = await create(season, hourly, 3000, 7);
    await admin`UPDATE instructor SET pay_mode = 'per_lesson' WHERE id = ${hourly}`;
    try {
      expect(await saveCourseRate(hourly, id, { rate: "30", unit: "hourly" })).toEqual({
        ok: true,
        rate: { cents: 3000, payMode: "hourly" },
      });
      expect(await stored(id)).toEqual({ cents: 3000, unit: "hourly" });
      expect(await audit(id)).toHaveLength(0);
      expect(await saveCourseRate(hourly, id, { rate: "31", unit: "hourly" })).toEqual({
        ok: false,
        message:
          "Le mode de rémunération de cet intervenant a changé : rechargez la page pour saisir le tarif dans la bonne unité.",
      });
      expect(await stored(id)).toEqual({ cents: 3000, unit: "hourly" });
    } finally {
      await admin`UPDATE instructor SET pay_mode = 'hourly' WHERE id = ${hourly}`;
    }
  });

  it("keeps a past season's rate as history (#192 Q5)", async () => {
    expect(await saveCourseRate(hourly, past, { rate: "50", unit: "hourly" })).toEqual({
      ok: false,
      message: `La saison de ce cours est terminée${NBSP}: son tarif est gardé tel quel.`,
    });
    expect(await stored(past)).toEqual({ cents: 3500, unit: "hourly" });
  });

  it("still edits a course on the last day of its season, not the day after", async () => {
    const id = await create(season, hourly, null, 1);
    session.today = "2027-06-30";
    expect(await saveCourseRate(hourly, id, { rate: "42", unit: "hourly" })).toEqual({
      ok: true,
      rate: { cents: 4200, payMode: "hourly" },
    });
    session.today = "2027-07-01";
    expect(await saveCourseRate(hourly, id, { rate: "", unit: "hourly" })).toEqual({
      ok: false,
      message: `La saison de ce cours est terminée${NBSP}: son tarif est gardé tel quel.`,
    });
    expect(await stored(id)).toEqual({ cents: 4200, unit: "hourly" });
  });

  it("refuses a course taught by another instructor, and unknown ids", async () => {
    expect(await saveCourseRate(flat, current, { rate: "", unit: "monthly_flat" })).toEqual({
      ok: false,
      message: `Ce cours est maintenant donné par un autre intervenant${NBSP}: rechargez la page.`,
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
        message: "Ce cours n’existe plus.",
      });
    } finally {
      session.schoolId = school;
    }
    expect(await stored(current)).toEqual({ cents: null, unit: null });
  });

  it("is not overwritten by the course form saved meanwhile, which keeps the new rate", async () => {
    const id = await create(season, hourly, null, 3);
    // The instructor page saves 50 € and stays open; the course form, saved meanwhile without
    // the rate field, keeps the stored rate. Without the course lock, it reads « none » before
    // the page commits, and writes it back over 50 €.
    const [page, form] = await overlapping(
      admin,
      (hold) =>
        withSchool(school, async (tx) => {
          const r = await setCourseRate(tx, hourly, id, { rate: 5000, unit: "hourly" }, TODAY);
          await hold();
          return r;
        }),
      () =>
        withSchool(school, (tx) =>
          updateCourse(tx, id, { ...base, weekday: 3, durationMinutes: 75, instructorRate: undefined }),
        ),
    );
    expect(page.ok).toBe(true);
    expect(form).toMatchObject({ ok: true, instructorRateCents: 5000 });
    expect(await withSchool(school, (tx) => courseRate(tx, id))).toEqual({ cents: 5000, payMode: "hourly" });
  });
});
