import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Instructor statements (#285) against the real database (app_user, RLS):
 * what they are computed from, and the CSV export with the session stubbed
 * (management only). Fictitious data deleted at the end; the audit log being
 * immutable, the cleanup disables its trigger within an administration
 * transaction, as the other tests writing to it do.
 */

type Role = "director" | "front_desk" | "teacher";
const session = vi.hoisted(() => ({ schoolId: "", userId: "", role: "director" as Role, today: "" }));
vi.mock("@/lib/session", () => ({
  requireRole: async (...roles: Role[]) => {
    // As requireRole: another role is sent away (redirect) before anything is read.
    if (!roles.includes(session.role)) throw new Error("NEXT_REDIRECT /");
    return { schoolId: session.schoolId, userId: session.userId, role: session.role };
  },
}));
// Vitest has no `@/` alias: the real modules, by relative path.
vi.mock("@/db", () => import("../../../../db/index"));
vi.mock("@/db/statements", () => import("../../../../db/statements"));
vi.mock("@/domain/payroll/month", () => import("../../../../domain/payroll/month"));
vi.mock("@/domain/payroll/statement", () => import("../../../../domain/payroll/statement"));
vi.mock("@/domain/payroll/statement-csv", () => import("../../../../domain/payroll/statement-csv"));
vi.mock("@/domain/people/age", () => ({ todayInParis: () => session.today }));

const { GET } = await import("./export/route");
const { statementData } = await import("../../../../db/statements");
const { updateInstructor, readInstructor } = await import("../../../../db/instructors");
const { logCourseRate } = await import("../../../../db/courses");
const { withSchool } = await import("../../../../db/index");
const { monthOf } = await import("../../../../domain/payroll/month");
const { monthStatement } = await import("../../../../domain/payroll/statement");
const { todayInParis } = await vi.importActual<typeof import("../../../../domain/people/age")>(
  "../../../../domain/people/age",
);

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const MONTH = "2027-10";
let school: string;
let otherSchool: string;
let perLesson: string;
let hourly: string;
let foreign: string;
let owner: string;
let courseA: string;
let courseB: string;

const INSTRUCTOR = `(school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)`;

/** A school with a season, a room and a discipline; returns what courses need. */
async function setUp(slug: string) {
  const [{ id }] = await admin`INSERT INTO school (name, slug) VALUES ('Zz École', ${slug}) RETURNING id`;
  const [season] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${id}, '2027-2028', '2027-09-01', '2028-06-30') RETURNING id`;
  const [site] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${id}, 'Zz Centre', '1 rue Test') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${id}, ${site.id}, 'Zz Studio') RETURNING id`;
  const [discipline] = await admin`INSERT INTO discipline (school_id, name) VALUES (${id}, 'Zz Jazz') RETURNING id`;
  return {
    id: id as string,
    season: season.id as string,
    room: room.id as string,
    discipline: discipline.id as string,
  };
}

const teacher = async (schoolId: string, name: string, payMode: string, rate: number) =>
  (
    await admin.unsafe(
      `INSERT INTO instructor ${INSTRUCTOR} VALUES ($1, $2, 'Zzfaux', 'sole_trader', 'franchise_293b', $3, $4) RETURNING id`,
      [schoolId, name, payMode, rate],
    )
  )[0].id as string;

const courseOf = async (s: Awaited<ReturnType<typeof setUp>>, instructorId: string, weekday: number, minutes: number) =>
  (
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${s.id}, ${s.season}, ${s.discipline}, ${s.room}, ${instructorId}, ${weekday}, '18:00', ${minutes}) RETURNING id`
  )[0].id as string;

const lessonOf = async (
  schoolId: string,
  courseId: string,
  instructorId: string,
  date: string,
  more: { status?: string; plannedDate?: string } = {},
) =>
  (
    await admin`INSERT INTO lesson (school_id, course_id, date, planned_date, status, instructor_id)
    VALUES (${schoolId}, ${courseId}, ${date}, ${more.plannedDate ?? null}, ${more.status ?? "planned"}::lesson_status, ${instructorId})
    RETURNING id`
  )[0].id as string;

/** Attendance taken (the lesson « effectuée »), the student present or not. */
const attendanceOf = async (lessonId: string, studentId: string, present: boolean) => {
  await admin`INSERT INTO attendance (school_id, lesson_id, student_id, present) VALUES (${school}, ${lessonId}, ${studentId}, ${present})`;
  await admin`UPDATE lesson SET status = 'done' WHERE id = ${lessonId}`;
};

beforeAll(async () => {
  const a = await setUp(`zz-st-a-${suffix}`);
  const b = await setUp(`zz-st-b-${suffix}`);
  school = a.id;
  otherSchool = b.id;
  perLesson = await teacher(school, "Zzséance", "per_lesson", 3000);
  hourly = await teacher(school, "Zzheure", "hourly", 2500);
  owner = await teacher(school, "Zzdirigeant", "per_lesson", 5000);
  await admin`UPDATE instructor SET is_owner = true WHERE id = ${owner}`;
  foreign = await teacher(otherSchool, "Zzailleurs", "per_lesson", 9900);
  const [student] = await admin`INSERT INTO person (school_id, last_name, first_name, is_student)
    VALUES (${school}, 'Zzélève', 'Test', true) RETURNING id`;
  courseA = await courseOf(a, perLesson, 2, 60);
  courseB = await courseOf(a, hourly, 3, 90);
  const ownerCourse = await courseOf(a, owner, 4, 60);
  // Per lesson: 4 lessons without attendance, 1 with a student present, 1 moved into October from September,
  // 1 where nobody came, 1 moved out to November, 1 cancelled: 6 owed.
  for (const d of ["05", "12", "19", "26"]) await lessonOf(school, courseA, perLesson, `2027-10-${d}`);
  await attendanceOf(await lessonOf(school, courseA, perLesson, "2027-10-01"), student.id, true);
  await lessonOf(school, courseA, perLesson, "2027-10-02", { plannedDate: "2027-09-28" });
  await attendanceOf(await lessonOf(school, courseA, perLesson, "2027-10-08"), student.id, false);
  await lessonOf(school, courseA, perLesson, "2027-11-03", { plannedDate: "2027-10-27" });
  await lessonOf(school, courseA, perLesson, "2027-10-13", { status: "cancelled" });
  // The hourly instructor substitutes once on the per-lesson instructor's course: paid 30,00 €.
  await lessonOf(school, courseA, hourly, "2027-10-20");
  await attendanceOf(await lessonOf(school, courseB, hourly, "2027-10-06"), student.id, true);
  // An owner's lesson: no statement.
  await lessonOf(school, ownerCourse, owner, "2027-10-07");
  // Another school's lessons in the same month.
  const foreignCourse = await courseOf(b, foreign, 2, 60);
  await lessonOf(otherSchool, foreignCourse, foreign, "2027-10-05");
  await admin`INSERT INTO closure (school_id, season_id, label, start_date, end_date, scope)
    VALUES (${school}, ${a.season}, 'Vacances', '2027-10-23', '2027-11-07', 'school'),
           (${school}, ${a.season}, 'Site fermé', '2027-10-10', '2027-10-10', 'sites'),
           (${otherSchool}, ${b.season}, 'Ailleurs', '2027-10-01', '2027-10-02', 'school')`;
  session.schoolId = school;
});

beforeEach(() => {
  session.role = "director";
  session.today = "2027-11-15";
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of [
    "attendance",
    "lesson",
    "closure",
    "course",
    "instructor",
    "person",
    "room",
    "site",
    "discipline",
    "season",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("statementData", () => {
  it("reads the school's own lessons, instructors and closures only (RLS)", async () => {
    const data = await withSchool(school, (tx) => statementData(tx, MONTH));
    expect(data.instructors.map((i) => i.id).sort()).toEqual([perLesson, hourly, owner].sort());
    expect(data.instructors.find((i) => i.id === owner)?.isOwner).toBe(true);
    expect(data.lessons).toHaveLength(11);
    expect(data.lessons.every((l) => l.instructorId !== foreign)).toBe(true);
    // The site closure is not a closure of the whole school.
    expect(data.closures).toEqual([{ startDate: "2027-10-23", endDate: "2027-11-07" }]);
  });

  it("finds nothing for another school's instructor", async () => {
    expect(await withSchool(school, (tx) => statementData(tx, MONTH, foreign))).toEqual({
      instructors: [],
      lessons: [],
      rateChanges: [],
      closures: [],
    });
    expect(await withSchool(school, (tx) => statementData(tx, MONTH, "pas-un-uuid"))).toMatchObject({
      instructors: [],
    });
  });

  it("gives the course's length and label to a lesson without its own", async () => {
    const data = await withSchool(school, (tx) => statementData(tx, MONTH, hourly));
    const own = data.lessons.find((l) => l.courseId === courseB);
    expect(own).toMatchObject({
      durationMinutes: 90,
      startTime: "18:00",
      courseLabel: "Zz Jazz, mercredi 18:00",
      attendance: { taken: true, present: 1 },
    });
    // A substituted lesson carries the regular teacher's pay; one without attendance says so.
    const replaced = data.lessons.find((l) => l.courseId === courseA);
    expect(replaced).toMatchObject({
      regular: { id: perLesson, payMode: "per_lesson", rateCents: 3000 },
      attendance: { taken: false, present: 0 },
    });
  });

  it("computes the month: 6 lessons at 30,00 €, a replacement at the regular rate, owners aside", async () => {
    const data = await withSchool(school, (tx) => statementData(tx, MONTH));
    const m = monthStatement({ month: MONTH, today: "2027-11-15", ...data });
    const byId = new Map(m.statements.map((s) => [s.instructorId, s]));
    expect(byId.get(perLesson)).toMatchObject({
      lessonCount: 6,
      totalCents: 18000,
      toPriceCount: 0,
      noAttendanceCount: 5,
      nobodyCameCount: 1,
      flags: ["no_attendance"],
    });
    // 37,50 € (1 h 30 at 25,00 €/h) + 30,00 € (replacement at the regular teacher's rate).
    expect(byId.get(hourly)).toMatchObject({ lessonCount: 2, totalCents: 6750, toPriceCount: 0 });
    expect(m.statements.map((s) => s.instructorId).sort()).toEqual([perLesson, hourly].sort());
  });

  it("finds the changes of pay and of a course rate since the first of the month, by instructor", async () => {
    const thisMonth = monthOf(todayInParis());
    const before = await withSchool(school, (tx) => readInstructor(tx, hourly));
    if (!before) throw new Error("instructor missing");
    const { id: _id, ...entry } = before;
    const saved = await withSchool(school, (tx) =>
      updateInstructor(tx, hourly, { ...entry, rateCents: 2600 }, todayInParis()),
    );
    expect(saved.ok).toBe(true);
    await withSchool(school, (tx) =>
      logCourseRate(
        tx,
        "zz-nobody",
        courseA,
        { instructorId: perLesson, instructorRateCents: null, instructorRatePayMode: null },
        { instructorId: perLesson, instructorRateCents: 3500, instructorRatePayMode: "per_lesson" },
      ),
    );
    const data = await withSchool(school, (tx) => statementData(tx, thisMonth));
    expect(data.rateChanges.map((c) => c.instructorId).sort()).toEqual([hourly, perLesson].sort());
    expect(data.rateChanges.every((c) => c.date === todayInParis())).toBe(true);
    // For one instructor too, the school's changes: a replacement is paid at the regular teacher's rate.
    const one = await withSchool(school, (tx) => statementData(tx, thisMonth, hourly));
    expect(one.rateChanges.map((c) => c.instructorId).sort()).toEqual([hourly, perLesson].sort());
    // A later month is not concerned.
    const next = `${Number(thisMonth.slice(0, 4)) + 1}${thisMonth.slice(4)}`;
    expect((await withSchool(school, (tx) => statementData(tx, next))).rateChanges).toEqual([]);
    // The other school never sees them.
    expect((await withSchool(otherSchool, (tx) => statementData(tx, thisMonth))).rateChanges).toEqual([]);
  });
});

describe("CSV export", () => {
  const exportOf = (q: string) => GET(new Request(`http://localhost/intervenants/releves/export?${q}`));
  /** The file as sent, BOM kept (a default TextDecoder drops it). */
  const text = async (r: Response) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(await r.arrayBuffer());

  it("exports the month for management, with a BOM and French headers", async () => {
    const r = await exportOf(`mois=${MONTH}`);
    expect(r.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(r.headers.get("Content-Disposition")).toContain(`releves-intervenants-${MONTH}.csv`);
    const csv = await text(r);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const rows = csv.slice(1).trimEnd().split("\r\n");
    expect(rows[0]).toBe("Intervenant;Date;Heure;Cours;Durée (min);Taux;Unité;Montant;Remarque");
    // 6 lessons and the « appel non fait » row.
    expect(rows.filter((r) => r.startsWith("Zzfaux Zzséance;"))).toHaveLength(7);
    expect(rows).toContain(
      "Zzfaux Zzheure;20/10/2027;18:00;Zz Jazz, mardi 18:00;60;30,00;séance;30,00;remplacement, au tarif du cours, appel non fait",
    );
    expect(csv).not.toContain("Zzailleurs");
    expect(csv).not.toContain("Zzdirigeant");
  });

  it("exports one instructor, never an owner nor another school's", async () => {
    const mine = (await text(await exportOf(`mois=${MONTH}&intervenant=${perLesson}`))).slice(1).trimEnd();
    expect(mine.split("\r\n")).toHaveLength(8);
    expect(mine).not.toContain("Zzheure");
    const owners = await text(await exportOf(`mois=${MONTH}&intervenant=${owner}`));
    expect(owners.slice(1).trimEnd().split("\r\n")).toHaveLength(1);
    const theirs = await text(await exportOf(`mois=${MONTH}&intervenant=${foreign}`));
    expect(theirs.slice(1).trimEnd().split("\r\n")).toEqual([
      "Intervenant;Date;Heure;Cours;Durée (min);Taux;Unité;Montant;Remarque",
    ]);
  });

  it("refuses the front desk and teachers", async () => {
    for (const role of ["front_desk", "teacher"] as const) {
      session.role = role;
      await expect(exportOf(`mois=${MONTH}`)).rejects.toThrow("NEXT_REDIRECT");
    }
  });
});
