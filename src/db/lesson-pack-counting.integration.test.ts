import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USED_UP } from "../domain/lesson-pack/pack";
import { withSchool } from "./index";
import { countLesson, lessonPacks, packsOf, uncountLesson } from "./lesson-packs";
import { cancelLesson, syncLessons } from "./lessons";

/**
 * Counting private lessons on a lesson pack (#286), as the application runs it
 * (app_user, RLS). Fictitious data deleted at the end; the audit log being
 * append-only, the cleanup disables its trigger in an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const frontDesk = `compte-accueil-${suffix}`;
const TODAY = "2026-11-02"; // a Monday
let school: string;
let otherSchool: string;
let season: string;
let discipline: string;
let room: string;
let teacher: string;
let payer: string;
let student: string;
let other: string;
let privateCourse: string;
let groupCourse: string;
const lessons: string[] = [];
let groupLesson: string;

const newPack = async (lessonCount: number, participant = student) => {
  const [{ id }] = await admin`INSERT INTO lesson_pack (school_id, payer_id, people_count, lesson_count, price_cents)
    VALUES (${school}, ${payer}, 1, ${lessonCount}, 20000) RETURNING id`;
  await admin`INSERT INTO lesson_pack_person (school_id, lesson_pack_id, person_id) VALUES (${school}, ${id}, ${participant})`;
  return id as string;
};
const usages = async (pack: string) =>
  (await admin`SELECT count(*)::int AS n FROM lesson_pack_usage WHERE lesson_pack_id = ${pack}`)[0].n as number;
const count = (lesson: string, pack: string, schoolId = school) =>
  withSchool(schoolId, (tx) => countLesson(tx, frontDesk, lesson, pack));
const uncount = (lesson: string, pack: string) =>
  withSchool(school, (tx) => uncountLesson(tx, frontDesk, lesson, pack));

beforeAll(async () => {
  [{ id: school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École décompte', ${`zzd-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz Autre école', ${`zze-${suffix}`}) RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${frontDesk}, 'Zz Accueil', ${`${frontDesk}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${frontDesk}, 'front_desk')`;
  [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2027-01-31') RETURNING id`;
  [{ id: discipline }] =
    await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Zzrock') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Zz Centre', '1 rue Zz') RETURNING id`;
  [{ id: room }] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Zz Studio') RETURNING id`;
  [{ id: teacher }] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${school}, 'Zzprof', 'Zzprénom', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  [{ id: payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzparent', 'Zzprénom') RETURNING id`;
  [{ id: student }] =
    await admin`INSERT INTO person (school_id, last_name, first_name, is_student) VALUES (${school}, 'Zzélève', 'Zzprénom', true) RETURNING id`;
  [{ id: other }] =
    await admin`INSERT INTO person (school_id, last_name, first_name, is_student) VALUES (${school}, 'Zzautre', 'Zzprénom', true) RETURNING id`;
  [{ id: privateCourse }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, type, weekday, start_time, duration_minutes)
      VALUES (${school}, ${season}, ${discipline}, ${room}, ${teacher}, 'private', 2, '17:00', 60) RETURNING id`;
  [{ id: groupCourse }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, type, weekday, start_time, duration_minutes)
      VALUES (${school}, ${season}, ${discipline}, ${room}, ${teacher}, 'group', 3, '17:00', 60) RETURNING id`;
  await withSchool(school, (tx) => syncLessons(tx, season, TODAY));
  for (const l of await admin`SELECT id FROM lesson WHERE course_id = ${privateCourse} ORDER BY date`)
    lessons.push(l.id as string);
  [{ id: groupLesson }] = await admin`SELECT id FROM lesson WHERE course_id = ${groupCourse} ORDER BY date LIMIT 1`;
  if (lessons.length < 12) throw new Error("not enough lessons generated");
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of [
    "lesson_pack_usage",
    "lesson_pack_person",
    "lesson_pack",
    "suspended_lesson",
    "lesson",
    "course",
    "person",
    "instructor",
    "room",
    "site",
    "discipline",
    "season",
    "member",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM "user" WHERE id = ${frontDesk}`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("counting a private lesson on a pack", () => {
  it("counts the lesson once, shows the remaining lessons and logs it", async () => {
    const pack = await newPack(10);
    expect(await count(lessons[0], pack)).toEqual({ ok: true });
    expect(await count(lessons[0], pack)).toEqual({ ok: true, already: true });
    expect(await usages(pack)).toBe(1);
    const [row] = await withSchool(school, (tx) => packsOf(tx, { countedOn: lessons[0] }));
    expect(row).toMatchObject({ id: pack, lessonCount: 10, usedCount: 1 });
    const [log] = await admin`SELECT action, after FROM audit_log
      WHERE target_table = 'lesson_pack_usage' AND row_id = ${pack}`;
    expect(log).toEqual({ action: "insert", after: { lessonPackId: pack, lessonId: lessons[0] } });
  });

  it("refuses a 6th lesson on a pack of 5 and writes nothing", async () => {
    const pack = await newPack(5);
    for (const l of lessons.slice(0, 5)) expect((await count(l, pack)).ok).toBe(true);
    expect(await count(lessons[5], pack)).toEqual({ ok: false, message: USED_UP });
    expect(await usages(pack)).toBe(5);
  });

  it("never over-uses a pack when two people count at the same moment", async () => {
    const pack = await newPack(2);
    expect((await count(lessons[6], pack)).ok).toBe(true);
    // The pack row is held while both counts start: without the lock in countLesson, both
    // would read one usage and both insert; with it, the second sees the first's usage.
    const results = await admin.begin(async (t) => {
      await t`SELECT id FROM lesson_pack WHERE id = ${pack} FOR UPDATE`;
      const both = Promise.all([count(lessons[7], pack), count(lessons[8], pack)]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return [both];
    });
    const [first, second] = await results[0];
    expect([first, second].filter((r) => r.ok)).toHaveLength(1);
    expect([first, second].find((r) => !r.ok)).toEqual({ ok: false, message: USED_UP });
    expect(await usages(pack)).toBe(2);
  });

  it("gives the lesson back when the count is undone, and the audit log keeps both", async () => {
    const pack = await newPack(5);
    await count(lessons[1], pack);
    expect(await uncount(lessons[1], pack)).toEqual({ ok: true });
    expect(await uncount(lessons[1], pack)).toEqual({ ok: true, already: true });
    expect(await usages(pack)).toBe(0);
    const logs = await admin`SELECT action FROM audit_log
      WHERE target_table = 'lesson_pack_usage' AND row_id = ${pack} ORDER BY id`;
    expect(logs.map((l) => l.action)).toEqual(["insert", "delete"]);
  });

  it("never counts a cancelled lesson, and refuses to cancel a counted one (Q2 default)", async () => {
    const pack = await newPack(5);
    expect((await withSchool(school, (tx) => cancelLesson(tx, lessons[9]))).ok).toBe(true);
    expect(await count(lessons[9], pack)).toEqual({
      ok: false,
      message: "Cette séance est annulée : elle ne se décompte pas.",
    });
    await count(lessons[10], pack);
    expect(await withSchool(school, (tx) => cancelLesson(tx, lessons[10]))).toEqual({
      ok: false,
      message: "Cette séance est décomptée d’un carnet : annulez d’abord le décompte.",
    });
    const [{ status }] = await admin`SELECT status FROM lesson WHERE id = ${lessons[10]}`;
    expect(status).toBe("planned");
  });

  it("counts only lessons of a private course", async () => {
    const pack = await newPack(5);
    expect(await count(groupLesson, pack)).toEqual({
      ok: false,
      message: "Seules les séances de cours particulier se décomptent sur un carnet.",
    });
  });

  it("offers the open packs, the ones of the lesson's students first", async () => {
    const mine = await newPack(3, student);
    const theirs = await newPack(3, other);
    const usedUp = await newPack(1, student);
    await count(lessons[11], usedUp);
    const { counted, offered } = await withSchool(school, (tx) => lessonPacks(tx, lessons[11], [student]));
    expect(counted.map((p) => p.id)).toEqual([usedUp]);
    const ids = offered.map((p) => p.id);
    expect(ids).toContain(mine);
    expect(ids).toContain(theirs);
    expect(ids).not.toContain(usedUp);
    expect(ids.indexOf(mine)).toBeLessThan(ids.indexOf(theirs));
  });

  it("cannot count on a pack of another school", async () => {
    const pack = await newPack(5);
    expect(await count(lessons[2], pack, otherSchool)).toEqual({ ok: false, message: "Ce carnet n’existe plus." });
    expect(await usages(pack)).toBe(0);
  });
});
