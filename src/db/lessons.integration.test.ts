import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { courseDates } from "../domain/schedule/lessons";
import { addDays } from "../domain/schedule/week";
import { createCourse, readCourse, updateCourse, deleteCourse } from "./courses";
import { withSchool } from "./index";
import {
  addClosure,
  cancelLesson,
  moveLesson,
  changeInstructor,
  saveAttendance,
  readAttendance,
  listClosures,
  weekLessons,
  courseLessons,
  dayLessons,
  deleteClosure,
  syncLessons,
} from "./lessons";

/** Lessons, closures and attendance, as the app does (app_user, RLS). Fictitious data deleted at the end. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let otherSchool: string;
let season: string;
let wednesday: string; // Wednesday 17:00 course
let camille: string;
let ines: string;
let inactive: string;
const students: Record<string, string> = {};

const TODAY = "2026-10-19"; // a Monday

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`sa-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`sb-${suffix}`}) RETURNING id`;
  [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2026-11-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Jazz') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Centre', '1 rue Test') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Studio') RETURNING id`;
  const teacher = async (firstName: string, active = true) =>
    (
      await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents, active)
        VALUES (${school}, 'Prof', ${firstName}, 'salarie', 'non_applicable', 'heure', 3000, ${active}) RETURNING id`
    )[0].id as string;
  camille = await teacher("Camille");
  ines = await teacher("Inès");
  inactive = await teacher("Ancien", false);
  [{ id: wednesday }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${school}, ${season}, ${d.id}, ${room.id}, ${camille}, 3, '17:00', 60) RETURNING id`;

  const [payer] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Martin', 'Paul') RETURNING id`;
  for (const [firstName, status] of [
    ["Léa", "active"],
    ["Zoé", "essai"],
    ["Jules", "liste_attente"],
    ["Max", "abandon"],
  ]) {
    [{ id: students[firstName] }] =
      await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Martin', ${firstName}) RETURNING id`;
    const [i] =
      await admin`INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents, status)
      VALUES (${school}, ${season}, ${payer.id}, 'enfant', 'trimestre', 10000, ${status}) RETURNING id`;
    await admin`INSERT INTO enrollment_course (school_id, enrollment_id, student_id, course_id) VALUES (${school}, ${i.id}, ${students[firstName]}, ${wednesday})`;
  }
});

afterAll(async () => {
  for (const t of [
    "attendance",
    "lesson",
    "course_date",
    "closure",
    "enrollment_course",
    "enrollment",
    "relationship",
    "person",
    "course",
    "instructor",
    "room",
    "site",
    "discipline",
    "season",
  ]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  }
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

const lessons = () => withSchool(school, (tx) => courseLessons(tx, wednesday));
const dates = async () => (await lessons()).map((s) => s.date);
const sync = () => withSchool(school, (tx) => syncLessons(tx, season, TODAY));

describe("fermetures et génération des séances", () => {
  it("génère les mercredis à venir de la saison, sans le passé, puis ne duplique rien", async () => {
    expect(await sync()).toEqual({ added: 6, removed: 0 });
    expect(await dates()).toEqual(["2026-10-21", "2026-10-28", "2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"]);
    expect(await sync()).toEqual({ added: 0, removed: 0 });
  });

  it("refuse une fermeture dont la fin précède le début", async () => {
    expect(
      await withSchool(school, (tx) =>
        addClosure(tx, season, { label: "Erreur", start: "2026-11-02", end: "2026-11-01" }),
      ),
    ).toEqual({
      ok: false,
      message: "La fin précède le début.",
    });
  });

  it("retire les séances d’une fermeture, puis les remet quand elle est supprimée", async () => {
    const r = await withSchool(school, (tx) =>
      addClosure(tx, season, { label: "Toussaint", start: "2026-10-17", end: "2026-11-01" }),
    );
    expect(r.ok).toBe(true);
    expect(await sync()).toEqual({ added: 0, removed: 2 });
    expect(await dates()).toEqual(["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"]);
    expect((await withSchool(school, (tx) => listClosures(tx, season))).map((f) => f.label)).toEqual(["Toussaint"]);

    await withSchool(school, (tx) => deleteClosure(tx, r.ok ? r.id : ""));
    expect(await sync()).toEqual({ added: 2, removed: 0 });
  });
});

describe("appel", () => {
  it("liste les danseurs inscrits et à l’essai, sans liste d’attente ni abandon", async () => {
    const [s] = await lessons();
    const attendance = await withSchool(school, (tx) => readAttendance(tx, s.id));
    expect(attendance).toMatchObject({
      date: "2026-10-21",
      status: "prevue",
      discipline: "Jazz",
      startTime: "17:00",
      instructorId: camille,
    });
    expect(attendance?.students.map((d) => `${d.firstName} ${d.status} ${d.present}`)).toEqual([
      "Léa active null",
      "Zoé essai null",
    ]);
  });

  it("enregistre l’appel, le corrige, et marque la séance effectuée", async () => {
    const [s] = await lessons();
    const lea = students["Léa"];
    const zoe = students["Zoé"];
    expect(
      await withSchool(school, (tx) =>
        saveAttendance(tx, s.id, [
          { studentId: lea, present: true },
          { studentId: zoe, present: false },
        ]),
      ),
    ).toEqual({ ok: true, id: s.id });
    await withSchool(school, (tx) =>
      saveAttendance(tx, s.id, [
        { studentId: lea, present: true },
        { studentId: zoe, present: true },
      ]),
    );
    const attendance = await withSchool(school, (tx) => readAttendance(tx, s.id));
    expect(attendance?.status).toBe("effectuee");
    expect(attendance?.students.map((d) => d.present)).toEqual([true, true]);
    expect((await lessons())[0]).toMatchObject({ presents: 2, absents: 0 });
  });

  it("refuse un danseur absent de la liste d’appel", async () => {
    const [s] = await lessons();
    expect(
      await withSchool(school, (tx) => saveAttendance(tx, s.id, [{ studentId: students["Jules"], present: true }])),
    ).toEqual({
      ok: false,
      message: "Un des danseurs ne suit pas ce cours.",
    });
  });

  it("ne retire jamais une séance dont l’appel est fait", async () => {
    await withSchool(school, (tx) =>
      addClosure(tx, season, { label: "Grève", start: "2026-10-21", end: "2026-10-21" }),
    );
    expect(await sync()).toEqual({ added: 0, removed: 0 });
    expect((await dates())[0]).toBe("2026-10-21");
  });
});

describe("remplacement et annulation", () => {
  it("met un remplaçant actif sur une séance, refuse un inactif", async () => {
    const s = (await lessons())[1];
    expect(await withSchool(school, (tx) => changeInstructor(tx, s.id, ines))).toEqual({ ok: true, id: s.id });
    expect((await withSchool(school, (tx) => readAttendance(tx, s.id)))?.instructorId).toBe(ines);
    expect(await withSchool(school, (tx) => changeInstructor(tx, s.id, inactive))).toEqual({
      ok: false,
      message: "Intervenant introuvable ou inactif.",
    });
  });

  it("annule une séance sans appel, refuse si l’appel est fait, et refuse l’appel d’une séance annulée", async () => {
    const [done, prevue] = await lessons();
    expect(await withSchool(school, (tx) => cancelLesson(tx, done.id))).toEqual({
      ok: false,
      message: "L’appel de cette séance est déjà fait.",
    });
    expect(await withSchool(school, (tx) => cancelLesson(tx, prevue.id))).toEqual({ ok: true, id: prevue.id });
    expect(
      await withSchool(school, (tx) => saveAttendance(tx, prevue.id, [{ studentId: students["Léa"], present: true }])),
    ).toEqual({
      ok: false,
      message: "Cette séance est annulée.",
    });
    // A cancelled lesson is neither recreated nor removed by the synchronisation.
    await sync();
    expect((await lessons())[1]).toMatchObject({ id: prevue.id, status: "annulee" });
  });

  it("donne les séances du jour, sans celles d’une autre école", async () => {
    const day = await withSchool(school, (tx) => dayLessons(tx, "2026-11-04"));
    expect(day.map((s) => `${s.startTime} ${s.discipline} ${s.doneAttendance}`)).toEqual(["17:00 Jazz false"]);
    expect(await withSchool(otherSchool, (tx) => dayLessons(tx, "2026-11-04"))).toEqual([]);
    expect(await withSchool(otherSchool, (tx) => readAttendance(tx, day[0].id))).toBeNull();
  });
});

describe("cours et séances", () => {
  it("un nouveau titulaire reprend les séances prévues de l’ancien, pas celles d’un remplaçant", async () => {
    const before = await lessons();
    const course = await withSchool(school, (tx) => readCourse(tx, wednesday));
    if (!course) throw new Error("cours introuvable");
    const {
      type,
      recurrence,
      weekday: weekday,
      startDate: startDate,
      endDate: endDate,
      dates,
      startTime: startTime,
      durationMinutes: durationMinutes,
      ageMin,
      ageMax,
      level: level,
      maxCapacity: maxCapacity,
    } = course;
    const entry = {
      type,
      recurrence,
      weekday: weekday,
      startDate: startDate,
      endDate: endDate,
      dates,
      startTime: startTime,
      durationMinutes: durationMinutes,
      ageMin,
      ageMax,
      level: level,
      maxCapacity: maxCapacity,
    };
    const r = await withSchool(school, (tx) =>
      updateCourse(tx, wednesday, {
        ...entry,
        discipline: { id: course.disciplineId },
        room: { id: course.roomId },
        instructorId: ines,
      }),
    );
    expect(r.ok).toBe(true);
    const after = await lessons();
    // Lesson taught (Camille) unchanged; Camille's planned lessons handed to Inès.
    expect(after[0].instructor).toBe(before[0].instructor);
    expect(after.filter((s) => s.status === "prevue").every((s) => s.instructor === "Inès Prof")).toBe(true);
  });

  it("refuse de supprimer un cours dont l’appel a été fait", async () => {
    await admin`DELETE FROM enrollment_course WHERE course_id = ${wednesday}`;
    expect(await withSchool(school, (tx) => deleteCourse(tx, wednesday))).toEqual({
      ok: false,
      message: "Des appels ont été faits pour ce cours : il ne peut pas être supprimé.",
    });
  });
});

describe("récurrences (#90)", () => {
  const datesDe = async (courseId: string) =>
    (await admin`SELECT date::text AS date FROM lesson WHERE course_id = ${courseId} ORDER BY date`).map(
      (r) => r.date as string,
    );

  it("une semaine sur deux, sur une période, et à dates précises (vacances comprises)", async () => {
    const template = await withSchool(school, (tx) => readCourse(tx, wednesday));
    if (!template) throw new Error("cours introuvable");
    const base = {
      discipline: { id: template.disciplineId },
      room: { id: template.roomId },
      instructorId: camille,
      type: "collectif" as const,
      startTime: "10:00",
      durationMinutes: 60,
      ageMin: null,
      ageMax: null,
      level: null,
      maxCapacity: null,
      startDate: null,
      endDate: null,
      dates: [],
    };
    const closures = (await withSchool(school, (tx) => listClosures(tx, season))).map(({ start: start, end: end }) => ({
      start: start,
      end: end,
    }));
    const create = (entry: Parameters<typeof createCourse>[2]) =>
      withSchool(school, async (tx) => {
        const r = await createCourse(tx, season, entry);
        if (!r.ok) throw new Error(r.message);
        return r.id;
      });
    const quinzaine = await create({ ...base, recurrence: "quinzaine", weekday: 1 });
    const period = await create({
      ...base,
      recurrence: "hebdomadaire",
      weekday: 2,
      startDate: "2026-11-01",
      endDate: "2026-11-17",
    });
    const stage = await create({
      ...base,
      type: "stage",
      recurrence: "dates",
      weekday: null,
      dates: ["2026-11-21", "2026-10-26", "2026-10-26"],
    });
    await sync();

    const wholeSeason = { start: "2026-09-01", end: "2026-11-30" };
    expect(await datesDe(quinzaine)).toEqual(
      courseDates({ type: "quinzaine", weekday: 1, startDate: null, endDate: null }, wholeSeason, closures).filter(
        (d) => d >= TODAY,
      ),
    );
    expect(await datesDe(period)).toEqual(
      courseDates(
        { type: "hebdomadaire", weekday: 2, startDate: "2026-11-01", endDate: "2026-11-17" },
        wholeSeason,
        closures,
      ),
    );
    expect(await datesDe(stage)).toEqual(["2026-10-26", "2026-11-21"]);
    expect((await withSchool(school, (tx) => readCourse(tx, stage)))?.dates).toEqual(["2026-10-26", "2026-11-21"]);

    // The workshop goes down to a single date: the removed lesson disappears.
    await withSchool(school, async (tx) => {
      const c = await readCourse(tx, stage);
      if (!c) throw new Error("stage introuvable");
      const {
        type,
        recurrence,
        weekday: weekday,
        startDate: startDate,
        endDate: endDate,
        startTime: startTime,
        durationMinutes: durationMinutes,
        ageMin,
        ageMax,
        level: level,
        maxCapacity: maxCapacity,
      } = c;
      await updateCourse(tx, stage, {
        type,
        recurrence,
        weekday: weekday,
        startDate: startDate,
        endDate: endDate,
        startTime: startTime,
        durationMinutes: durationMinutes,
        ageMin,
        ageMax,
        level: level,
        maxCapacity: maxCapacity,
        dates: ["2026-11-21"],
        discipline: { id: c.disciplineId },
        room: { id: c.roomId },
        instructorId: c.instructorId,
      });
    });
    await sync();
    expect(await datesDe(stage)).toEqual(["2026-11-21"]);

    for (const id of [quinzaine, period, stage])
      expect((await withSchool(school, (tx) => deleteCourse(tx, id))).ok).toBe(true);
  });
});

describe("planning daté : déplacer une séance (#90)", () => {
  let monday: string;
  const list = async () =>
    (
      await admin`SELECT id, date::text AS date, planned_date::text AS prevue, to_char(start_time, 'HH24:MI') AS heure, instructor_id AS prof
        FROM lesson WHERE course_id = ${monday} ORDER BY date`
    ).map((r) => ({
      id: r.id as string,
      date: r.date as string,
      prevue: r.prevue as string | null,
      heure: r.heure as string | null,
      teacher: r.prof as string,
    }));
  const move = (
    id: string,
    slot: { date: string; startTime: string; durationMinutes: number },
    scope: "seance" | "suivantes",
  ) =>
    withSchool(school, async (tx) => {
      const r = await moveLesson(tx, id, slot, scope);
      if (r.status === "ok") await syncLessons(tx, r.seasonId, TODAY, r.since ?? undefined);
      return r;
    });

  beforeAll(async () => {
    const template = await admin`SELECT discipline_id, room_id FROM course WHERE id = ${wednesday}`;
    [{ id: monday }] =
      await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${school}, ${season}, ${template[0].discipline_id}, ${template[0].room_id}, ${camille}, 1, '10:00', 60) RETURNING id`;
    await sync();
  });

  it("cette séance seulement : elle change de jour et d'heure, sans être recréée à sa date d'origine", async () => {
    const before = await list();
    const target = before[1];
    expect(
      await move(target.id, { date: "2026-10-27", startTime: "11:30", durationMinutes: 60 }, "seance"),
    ).toMatchObject({ status: "ok" });
    await sync();
    const after = await list();
    expect(after).toHaveLength(before.length);
    expect(after.find((x) => x.id === target.id)).toMatchObject({
      date: "2026-10-27",
      prevue: target.date,
      heure: "11:30",
    });
    const week = await withSchool(school, (tx) => weekLessons(tx, "2026-10-26"));
    expect(week.find((x) => x.id === target.id)).toMatchObject({ startTime: "11:30", moved: true });
  });

  it("refuse une date déjà prise par le cours, hors saison, ou une séance annulée", async () => {
    const [a, b] = await list();
    expect(await move(a.id, { date: b.date, startTime: "10:00", durationMinutes: 60 }, "seance")).toEqual({
      status: "refus",
      message: "Ce cours a déjà une séance ce jour-là.",
    });
    expect(await move(a.id, { date: "2027-01-04", startTime: "10:00", durationMinutes: 60 }, "seance")).toEqual({
      status: "refus",
      message: "Cette date est en dehors de la saison.",
    });
    await withSchool(school, (tx) => cancelLesson(tx, a.id));
    expect((await move(a.id, { date: "2026-10-20", startTime: "10:00", durationMinutes: 60 }, "seance")).status).toBe(
      "refus",
    );
  });

  it("cette séance et les suivantes : le cours change, les précédentes gardent leur heure, le remplaçant reste", async () => {
    const before = await list();
    const [, , pivot, then] = before;
    await withSchool(school, (tx) => changeInstructor(tx, then.id, ines));
    const r = await move(
      pivot.id,
      { date: addDays(pivot.date, 1), startTime: "18:30", durationMinutes: 90 },
      "suivantes",
    );
    expect(r).toMatchObject({ status: "ok" });
    const [c] =
      await admin`SELECT weekday, to_char(start_time, 'HH24:MI') AS h, duration_minutes FROM course WHERE id = ${monday}`;
    expect(c).toMatchObject({ weekday: 2, h: "18:30", duration_minutes: 90 });
    const after = await list();
    // Before the pivot: still Monday, original time frozen (except the lesson already moved).
    for (const x of after.filter((x) => (x.prevue ?? x.date) < pivot.date))
      expect(x.heure === "10:00" || x.heure === "11:30").toBe(true);
    // From the pivot on: Tuesday, at the course time; the substitute of the next lesson is kept.
    const following = after.filter((x) => x.date > pivot.date);
    expect(following.every((x) => new Date(`${x.date}T00:00:00Z`).getUTCDay() === 2 && x.heure === null)).toBe(true);
    expect(after.find((x) => x.id === then.id)?.teacher).toBe(ines);
  });
});
