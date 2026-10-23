import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCourse,
  moveCourse,
  readCourse,
  updateCourse,
  scheduleReferential,
  type CourseInput,
  deleteCourse,
} from "./courses";
import { withSchool } from "./index";

/** Édition du planning, comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let otherSchool: string;
let season: string;
let site: string;
let room: string;
let teacher: string;
let inactiveTeacher: string;
let foreignRoom: string;
let base: CourseInput;

const INSTRUCTOR = `(school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents, active)`;

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ca-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`cb-${suffix}`}) RETURNING id`;
  [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: site }] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Centre', '1 rue Test') RETURNING id`;
  [{ id: room }] =
    await admin`INSERT INTO room (school_id, site_id, name, capacity) VALUES (${school}, ${site}, 'Studio', 20) RETURNING id`;
  [{ id: teacher }] = await admin.unsafe(
    `INSERT INTO instructor ${INSTRUCTOR}
    VALUES ($1, 'Durand', 'Camille', 'salarie', 'non_applicable', 'heure', 3000, true) RETURNING id`,
    [school],
  );
  [{ id: inactiveTeacher }] = await admin.unsafe(
    `INSERT INTO instructor ${INSTRUCTOR}
    VALUES ($1, 'Ancien', 'Prof', 'salarie', 'non_applicable', 'heure', 3000, false) RETURNING id`,
    [school],
  );
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${otherSchool}, 'Ailleurs', '2 rue Test') RETURNING id`;
  [{ id: foreignRoom }] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${otherSchool}, ${s.id}, 'Autre') RETURNING id`;
  base = {
    discipline: { name: "Jazz" },
    room: { id: room },
    instructorId: teacher,
    type: "collectif",
    recurrence: "hebdomadaire",
    weekday: 3,
    startDate: null,
    endDate: null,
    dates: [],
    startTime: "17:00",
    durationMinutes: 60,
    ageMin: 8,
    ageMax: 11,
    level: "Débutant",
    maxCapacity: 18,
  };
});

afterAll(async () => {
  for (const t of [
    "enrollment_course",
    "enrollment",
    "relationship",
    "person",
    "course",
    "room",
    "site",
    "discipline",
    "instructor",
    "season",
  ]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  }
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("creerCours", () => {
  it("crée le cours et la discipline nouvelle, puis le relit", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    expect(r.ok).toBe(true);
    const id = r.ok ? r.id : "";
    const lu = await withSchool(school, (tx) => readCourse(tx, id));
    expect(lu).toMatchObject({
      roomId: room,
      instructorId: teacher,
      weekday: 3,
      startTime: "17:00",
      maxCapacity: 18,
      level: "Débutant",
    });
    const [{ n }] =
      await admin`SELECT count(*)::int AS n FROM discipline WHERE school_id = ${school} AND name = 'Jazz'`;
    expect(n).toBe(1);
  });

  it("réutilise une discipline existante, sans tenir compte de la casse", async () => {
    await withSchool(school, (tx) => createCourse(tx, season, { ...base, discipline: { name: " jazz " }, weekday: 5 }));
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM discipline WHERE school_id = ${school}`;
    expect(n).toBe(1);
  });

  it("crée une salle et un site à la volée", async () => {
    const r = await withSchool(school, (tx) =>
      createCourse(tx, season, {
        ...base,
        room: { name: "Salle bleue", capacity: 12, site: { name: "Nord", address: "40 avenue des Arts" } },
      }),
    );
    expect(r.ok).toBe(true);
    const [s] =
      await admin`SELECT s.name, s.capacity, si.name AS site FROM room s JOIN site si ON si.id = s.site_id WHERE s.school_id = ${school} AND s.name = 'Salle bleue'`;
    expect(s).toMatchObject({ capacity: 12, site: "Nord" });
  });

  it("refuse une salle d’une autre école", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, { ...base, room: { id: foreignRoom } }));
    expect(r).toEqual({ ok: false, message: "Salle introuvable." });
  });

  it("refuse un intervenant inactif pour un nouveau cours", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, { ...base, instructorId: inactiveTeacher }));
    expect(r).toEqual({ ok: false, message: "Intervenant introuvable ou inactif." });
  });
});

describe("modifierCours", () => {
  it("modifie l’horaire et la capacité", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    const id = r.ok ? r.id : "";
    const m = await withSchool(school, (tx) =>
      updateCourse(tx, id, { ...base, startTime: "18:15", maxCapacity: null }),
    );
    expect(m).toEqual({ ok: true, id });
    expect(await withSchool(school, (tx) => readCourse(tx, id))).toMatchObject({
      startTime: "18:15",
      maxCapacity: null,
    });
  });

  it("garde un intervenant devenu inactif s’il était déjà sur le cours", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    const id = r.ok ? r.id : "";
    await admin`UPDATE course SET instructor_id = ${inactiveTeacher} WHERE id = ${id}`;
    const m = await withSchool(school, (tx) =>
      updateCourse(tx, id, { ...base, instructorId: inactiveTeacher, level: "Moyen" }),
    );
    expect(m.ok).toBe(true);
  });

  it("ne modifie pas un cours inconnu", async () => {
    const m = await withSchool(otherSchool, (tx) => updateCourse(tx, "00000000-0000-4000-8000-000000000000", base));
    expect(m).toEqual({ ok: false, message: "Ce cours n’existe plus." });
  });
});

describe("supprimerCours", () => {
  it("supprime un cours sans inscrit", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    const id = r.ok ? r.id : "";
    expect(await withSchool(school, (tx) => deleteCourse(tx, id))).toEqual({ ok: true, id });
    expect(await withSchool(school, (tx) => readCourse(tx, id))).toBeNull();
  });

  it("refuse de supprimer un cours avec des inscrits", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    const id = r.ok ? r.id : "";
    const [p] = await admin`INSERT INTO person (school_id, last_name) VALUES (${school}, 'Martin') RETURNING id`;
    const [d] =
      await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Martin', 'Léa') RETURNING id`;
    const [i] = await admin`
      INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents, status)
      VALUES (${school}, ${season}, ${p.id}, 'enfant', 'trimestre', 10000, 'active') RETURNING id`;
    await admin`INSERT INTO enrollment_course (school_id, enrollment_id, student_id, course_id) VALUES (${school}, ${i.id}, ${d.id}, ${id})`;
    expect(await withSchool(school, (tx) => deleteCourse(tx, id))).toEqual({
      ok: false,
      message: "Ce cours a 1 inscription : il ne peut pas être supprimé.",
    });
  });
});

describe("referentielPlanning", () => {
  it("donne disciplines, salles avec leur site et intervenants actifs de l’école", async () => {
    const r = await withSchool(school, (tx) => scheduleReferential(tx));
    expect(r.salles).toContainEqual({ id: room, name: "Studio", site: "Centre", siteId: site, capacity: 20 });
    expect(r.salles.map((s) => s.id)).not.toContain(foreignRoom);
    expect(r.instructors.map((i) => i.id)).toEqual([teacher]);
    expect(r.sites.map((s) => s.name)).toContain("Centre");
    expect(r.disciplines.map((d) => d.name)).toContain("Jazz");
  });
});

describe("deplacerCours (vue agenda)", () => {
  it("déplace et étire un cours sans inscrit", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    const id = r.ok ? r.id : "";
    expect(
      await withSchool(school, (tx) =>
        moveCourse(tx, id, { weekday: 4, startTime: "18:15", durationMinutes: 90 }, false),
      ),
    ).toEqual({ status: "ok", id });
    expect(await withSchool(school, (tx) => readCourse(tx, id))).toMatchObject({
      weekday: 4,
      startTime: "18:15",
      durationMinutes: 90,
    });
  });

  it("demande confirmation quand des élèves sont inscrits, puis déplace", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    const id = r.ok ? r.id : "";
    const [p] = await admin`INSERT INTO person (school_id, last_name) VALUES (${school}, 'Payeur') RETURNING id`;
    const [d] =
      await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Petit', 'Lou') RETURNING id`;
    const [i] =
      await admin`INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents, status)
      VALUES (${school}, ${season}, ${p.id}, 'enfant', 'trimestre', 10000, 'active') RETURNING id`;
    await admin`INSERT INTO enrollment_course (school_id, enrollment_id, student_id, course_id) VALUES (${school}, ${i.id}, ${d.id}, ${id})`;
    const slot = { weekday: 5, startTime: "17:00", durationMinutes: 60 };
    expect(await withSchool(school, (tx) => moveCourse(tx, id, slot, false))).toEqual({
      status: "confirmer",
      enrolled: 1,
    });
    expect((await withSchool(school, (tx) => readCourse(tx, id)))?.weekday).toBe(3);
    expect(await withSchool(school, (tx) => moveCourse(tx, id, slot, true))).toEqual({ status: "ok", id });
    expect((await withSchool(school, (tx) => readCourse(tx, id)))?.weekday).toBe(5);
  });

  it("refuse un cours qui finirait après minuit, un stage, et un cours d’une autre école", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    const id = r.ok ? r.id : "";
    expect(
      await withSchool(school, (tx) =>
        moveCourse(tx, id, { weekday: 3, startTime: "23:30", durationMinutes: 60 }, true),
      ),
    ).toEqual({
      status: "refus",
      message: "Le cours finirait après minuit.",
    });
    const stage = await withSchool(school, (tx) =>
      createCourse(tx, season, { ...base, type: "stage", recurrence: "dates", weekday: null, dates: ["2026-10-24"] }),
    );
    expect(
      await withSchool(school, (tx) =>
        moveCourse(tx, stage.ok ? stage.id : "", { weekday: 3, startTime: "10:00", durationMinutes: 60 }, true),
      ),
    ).toEqual({
      status: "refus",
      message: "Un cours à dates précises se modifie depuis sa fiche.",
    });
    expect(
      await withSchool(otherSchool, (tx) =>
        moveCourse(tx, id, { weekday: 2, startTime: "10:00", durationMinutes: 60 }, true),
      ),
    ).toEqual({
      status: "refus",
      message: "Ce cours n’existe plus.",
    });
  });
});
