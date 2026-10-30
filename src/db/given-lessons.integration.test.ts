import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCourse, moveCourse, updateCourse, type CourseInput } from "./courses";
import { readInstructor, updateInstructor } from "./instructors";
import { readAttendance } from "./lessons";
import { statementData } from "./statements";
import { withSchool } from "./index";
import { schoolWithDefaultEntity } from "./billing-entity.integration-helpers";
import { monthOf } from "../domain/payroll/month";
import { monthStatement } from "../domain/payroll/statement";
import { todayInParis } from "../domain/people/age";

/**
 * Lessons already given keep what they were given with (#310): a course
 * changing hands, time or length stamps its past lessons, and statements pay
 * them on the lesson, not on the course's current data. Against the real
 * database (app_user, RLS), dated around the real today since « given » is
 * before today in Paris. Fictitious data deleted at the end; the audit log
 * being immutable, the cleanup disables its trigger within an administration
 * transaction, as the other tests writing to it do.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const TODAY = todayInParis();
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** Last month: every lesson in it is given, whatever today's day. */
const LAST = monthOf(shift(`${TODAY.slice(0, 7)}-01`, -1));
const day = (d: number) => `${LAST}-${String(d).padStart(2, "0")}`;
const NEXT_WEEK = shift(TODAY, 7);

let school: string;
let season: string;
let hourly: string;
let perLesson: string;
let substitute: string;
let owner: string;
let flat: string;
let flatGone: string;
let base: CourseInput;

const INSTRUCTOR = `(school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents, is_owner, active)`;
const teacher = async (name: string, payMode: string, rate: number, isOwner = false, active = true) =>
  (
    await admin.unsafe(
      `INSERT INTO instructor ${INSTRUCTOR} VALUES ($1, $2, 'Zzfaux', 'sole_trader', 'not_applicable', $3, $4, $5, $6)
       RETURNING id`,
      [school, name, payMode, rate, isOwner, active],
    )
  )[0].id as string;

const lessonOf = async (courseId: string, instructorId: string, date: string, status = "done") =>
  (
    await admin`INSERT INTO lesson (school_id, course_id, date, status, instructor_id)
      VALUES (${school}, ${courseId}, ${date}, ${status}::lesson_status, ${instructorId}) RETURNING id`
  )[0].id as string;

const lessonRow = async (id: string) =>
  (
    await admin`SELECT instructor_id, regular_instructor_id, duration_minutes, to_char(start_time, 'HH24:MI') AS start_time
      FROM lesson WHERE id = ${id}`
  )[0];

const create = async (entry: CourseInput) => {
  const r = await withSchool(school, (tx) => createCourse(tx, season, entry));
  if (!r.ok) throw new Error(r.message);
  return r.id;
};

const statementOf = async (instructorId: string) => {
  const data = await withSchool(school, (tx) => statementData(tx, LAST));
  return monthStatement({ month: LAST, today: TODAY, ...data }).statements.find((s) => s.instructorId === instructorId);
};

beforeAll(async () => {
  [{ id: school }] = await schoolWithDefaultEntity(admin, "Zz École", `zz-given-${suffix}`);
  [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, 'Zz saison', ${shift(TODAY, -120)}, ${shift(TODAY, 120)}) RETURNING id`;
  const [site] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Zz Centre', '1 rue Test') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${site.id}, 'Zz Studio') RETURNING id`;
  hourly = await teacher("Zzheure", "hourly", 4000);
  perLesson = await teacher("Zzséance", "per_lesson", 3000);
  substitute = await teacher("Zzremplaçant", "hourly", 2000);
  owner = await teacher("Zzdirigeant", "per_lesson", 5000, true);
  flat = await teacher("Zzforfait", "monthly_flat", 80000);
  flatGone = await teacher("Zzparti", "monthly_flat", 80000, false, false);
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
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id = ${school}`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of ["lesson", "course_date", "course", "instructor", "room", "site", "discipline", "season"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  await admin`DELETE FROM school WHERE id = ${school}`;
  await admin.end();
});

describe("a course's length changed (#310)", () => {
  it("pays the lessons already given for the length they had, the upcoming ones at the new length", async () => {
    const id = await create(base);
    const given = await lessonOf(id, hourly, day(5));
    const replaced = await lessonOf(id, substitute, day(12));
    const upcoming = await lessonOf(id, hourly, NEXT_WEEK, "planned");
    const r = await withSchool(school, (tx) => updateCourse(tx, id, { ...base, durationMinutes: 90 }));
    expect(r.ok).toBe(true);
    expect(await lessonRow(given)).toMatchObject({ duration_minutes: 60, start_time: "18:00" });
    expect(await lessonRow(upcoming)).toMatchObject({ duration_minutes: null, start_time: null });
    // 40,00 €/h × 1 h, not × 1 h 30.
    expect((await statementOf(hourly))?.totalCents).toBe(4000);
    // The substitute is paid at the regular teacher's rate, for the length taught.
    const s = await statementOf(substitute);
    expect(s?.courses[0].lines[0]).toMatchObject({ lessonId: replaced, minutes: 60, amountCents: 4000 });
  });

  it("keeps a lesson's own length (moved lesson) and does not stamp when the slot does not change", async () => {
    const id = await create({ ...base, weekday: 3 });
    const own = await lessonOf(id, hourly, day(6));
    await admin`UPDATE lesson SET start_time = '17:00', duration_minutes = 45 WHERE id = ${own}`;
    const plain = await lessonOf(id, hourly, day(13));
    expect((await withSchool(school, (tx) => updateCourse(tx, id, { ...base, weekday: 3, level: "Zz" }))).ok).toBe(
      true,
    );
    expect(await lessonRow(plain)).toMatchObject({ duration_minutes: null, start_time: null });
    await withSchool(school, (tx) =>
      updateCourse(tx, id, { ...base, weekday: 3, startTime: "19:00", durationMinutes: 75 }),
    );
    expect(await lessonRow(own)).toMatchObject({ duration_minutes: 45, start_time: "17:00" });
    expect(await lessonRow(plain)).toMatchObject({ duration_minutes: 60, start_time: "18:00" });
  });

  it("does the same when the course is dragged to a new slot on the calendar", async () => {
    const id = await create({ ...base, weekday: 4 });
    const given = await lessonOf(id, hourly, day(7));
    const r = await withSchool(school, (tx) =>
      moveCourse(tx, id, { weekday: 5, startTime: "10:00", durationMinutes: 120 }, true),
    );
    expect(r.status).toBe("ok");
    expect(await lessonRow(given)).toMatchObject({ duration_minutes: 60, start_time: "18:00" });
  });
});

describe("a course handed to another instructor (#310)", () => {
  it("keeps the outgoing teacher's lessons theirs, even when handed to an owner, then to someone else", async () => {
    const id = await create({ ...base, instructorId: perLesson, weekday: 1 });
    const given = await lessonOf(id, perLesson, day(4));
    const replaced = await lessonOf(id, substitute, day(11));
    const upcoming = await lessonOf(id, perLesson, NEXT_WEEK, "planned");
    const toOwner = await withSchool(school, (tx) =>
      updateCourse(tx, id, { ...base, instructorId: owner, weekday: 1, instructorRate: undefined }),
    );
    expect(toOwner.ok).toBe(true);
    expect(await lessonRow(given)).toMatchObject({ instructor_id: perLesson, regular_instructor_id: perLesson });
    expect(await lessonRow(upcoming)).toMatchObject({ instructor_id: owner, regular_instructor_id: null });
    // Not « remplacement », not « à chiffrer »: 30,00 € for their lesson.
    const own = await statementOf(perLesson);
    expect(own?.courses.find((c) => c.courseId === id)?.lines).toEqual([
      expect.objectContaining({ lessonId: given, substitute: false, amountCents: 3000, toPrice: null }),
    ]);
    // The substitute replaced the per-lesson teacher, not the owner: priced at 30,00 €.
    const sub = await statementOf(substitute);
    expect(sub?.courses.find((c) => c.courseId === id)?.lines).toEqual([
      expect.objectContaining({ lessonId: replaced, substitute: true, amountCents: 3000, toPrice: null }),
    ]);
    // The attendance sheet names the teacher of the time too.
    expect((await withSchool(school, (tx) => readAttendance(tx, given)))?.regularInstructorId).toBe(perLesson);
    // Handed on again: the lessons already stamped keep their teacher.
    await withSchool(school, (tx) =>
      updateCourse(tx, id, { ...base, instructorId: hourly, weekday: 1, instructorRate: undefined }),
    );
    expect(await lessonRow(given)).toMatchObject({ regular_instructor_id: perLesson });
  });
});

describe("monthly flat instructors and owners (#310)", () => {
  it("lists an active monthly flat instructor without lessons, flagged, but not an inactive one", async () => {
    const s = await statementOf(flat);
    expect(s).toMatchObject({ lessonCount: 0, totalCents: 0, flags: ["flat_no_lesson"] });
    expect(await statementOf(flatGone)).toBeUndefined();
  });

  it("audits a change of owner status, read as a change of the month's rates", async () => {
    const before = await withSchool(school, (tx) => readInstructor(tx, owner));
    if (!before) throw new Error("instructor missing");
    const { id: _id, ...entry } = before;
    const saved = await withSchool(school, (tx) => updateInstructor(tx, owner, { ...entry, isOwner: false }, TODAY));
    expect(saved.ok).toBe(true);
    const [row] = await admin`SELECT before, after FROM audit_log
      WHERE school_id = ${school} AND target_table = 'instructor' AND row_id = ${owner}`;
    expect(row.before).toMatchObject({ isOwner: true });
    expect(row.after).toMatchObject({ isOwner: false });
    const data = await withSchool(school, (tx) => statementData(tx, monthOf(TODAY)));
    expect(data.rateChanges.map((c) => c.instructorId)).toContain(owner);
  });
});
