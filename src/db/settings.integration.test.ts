import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { addClosure } from "./lessons";
import {
  createDiscipline,
  createSeason,
  createRoom,
  createSite,
  saveHours,
  hoursBySite,
  listDisciplines,
  listPlaces,
  listSeasons,
  updateSeason,
  updateRoom,
  renameDiscipline,
  deleteDiscipline,
  deleteRoom,
  deleteSite,
} from "./settings";

/** School settings (#80), as the application runs them (app_user, RLS). Fictitious data deleted at the end. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let otherSchool: string;
let season2026: string;
let jazz: string;
let center: string;
let studio: string;
const TODAY = "2026-08-01";

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`pa-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`pb-${suffix}`}) RETURNING id`;
  await admin`INSERT INTO discipline (school_id, name) VALUES (${otherSchool}, 'Jazz')`;
});

afterAll(async () => {
  for (const t of [
    "site_hours",
    "lesson_pack_tariff",
    "discount",
    "tariff",
    "course",
    "instructor",
    "room",
    "site",
    "discipline",
    "closure",
    "season",
  ]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  }
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("seasons", () => {
  it("creates a season, rejects a taken label, reversed or overlapping dates", async () => {
    const r = await withSchool(school, (tx) =>
      createSeason(tx, { label: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30" }, null),
    );
    expect(r.ok).toBe(true);
    season2026 = r.ok ? r.id : "";
    expect(
      await withSchool(school, (tx) =>
        createSeason(tx, { label: "2026-2027", startDate: "2027-09-01", endDate: "2028-06-30" }, null),
      ),
    ).toEqual({
      ok: false,
      message: "Une saison porte déjà ce libellé.",
    });
    expect(
      await withSchool(school, (tx) =>
        createSeason(tx, { label: "X", startDate: "2028-06-30", endDate: "2028-01-01" }, null),
      ),
    ).toEqual({
      ok: false,
      message: "La fin doit suivre le début.",
    });
    expect(
      await withSchool(school, (tx) =>
        createSeason(tx, { label: "Été", startDate: "2027-06-01", endDate: "2027-08-31" }, null),
      ),
    ).toEqual({
      ok: false,
      message: "Ces dates chevauchent la saison 2026-2027.",
    });
  });

  it("copies the tariff grid, discounts and lesson packs from the previous season", async () => {
    await admin`INSERT INTO tariff (school_id, season_id, audience, period, combination, price_cents)
      VALUES (${school}, ${season2026}, 'child', 'quarter', '{60}', 11000), (${school}, ${season2026}, 'adult', 'year', '{60,90}', 61500)`;
    await admin`INSERT INTO discount (school_id, season_id, code, rate_bps, min_students, audiences, combinable_with_multi_discipline)
      VALUES (${school}, ${season2026}, 'fratrie', 1000, 2, '{child}', false)`;
    await admin`INSERT INTO lesson_pack_tariff (school_id, season_id, lesson_count, max_people, price_cents) VALUES (${school}, ${season2026}, 5, 1, 25000)`;
    const r = await withSchool(school, (tx) =>
      createSeason(tx, { label: "2027-2028", startDate: "2027-09-01", endDate: "2028-06-30" }, season2026),
    );
    const id = r.ok ? r.id : "";
    const [{ tariffs }] = await admin`SELECT count(*)::int AS tariffs FROM tariff WHERE season_id = ${id}`;
    const [{ siblings }] =
      await admin`SELECT rate_bps AS siblings FROM discount WHERE season_id = ${id} AND code = 'fratrie'`;
    const [{ lessonPacks }] =
      await admin`SELECT count(*)::int AS "lessonPacks" FROM lesson_pack_tariff WHERE season_id = ${id}`;
    expect({ tariffs, siblings, lessonPacks }).toEqual({
      tariffs: 2,
      siblings: 1000,
      lessonPacks: 1,
    });
    expect((await withSchool(school, (tx) => listSeasons(tx))).map((s) => `${s.label} ${s.tariffs}`)).toEqual([
      "2027-2028 2",
      "2026-2027 2",
    ]);
  });

  it("updates a season's dates without overlapping the other one", async () => {
    const entry = { label: "2026-2027", startDate: "2026-08-25", endDate: "2027-07-05" };
    expect((await withSchool(school, (tx) => updateSeason(tx, season2026, entry, TODAY))).ok).toBe(true);
    expect(
      await withSchool(school, (tx) => updateSeason(tx, season2026, { ...entry, endDate: "2027-09-15" }, TODAY)),
    ).toEqual({
      ok: false,
      message: "Ces dates chevauchent la saison 2027-2028.",
    });
  });

  it("refuses new dates that would leave closures outside the season, naming them (#194)", async () => {
    // Season now 2026-08-25 → 2027-07-05.
    await admin`INSERT INTO closure (school_id, season_id, label, start_date, end_date) VALUES
      (${school}, ${season2026}, 'Zz Rentrée', '2026-08-25', '2026-08-25'),
      (${school}, ${season2026}, 'Zz Noël', '2026-12-19', '2027-01-04'),
      (${school}, ${season2026}, 'Zz Gala', '2027-06-28', '2027-07-05')`;
    const edit = (startDate: string, endDate: string) =>
      withSchool(school, (tx) => updateSeason(tx, season2026, { label: "2026-2027", startDate, endDate }, TODAY));
    const dates = async () =>
      (await admin`SELECT start_date::text AS s, end_date::text AS e FROM season WHERE id = ${season2026}`)[0];

    expect(await edit("2026-08-26", "2027-07-04")).toEqual({
      ok: false,
      message:
        "Ces fermetures sortiraient de la saison : Zz Rentrée (le 25/08/2026), Zz Gala (du 28/06/2027 au 05/07/2027). Supprimez-les dans Planning › Fermetures, puis recréez-les avec les bonnes dates.",
    });
    expect(await edit("2026-08-25", "2027-07-04")).toEqual({
      ok: false,
      message:
        "Cette fermeture sortirait de la saison : Zz Gala (du 28/06/2027 au 05/07/2027). Supprimez-la dans Planning › Fermetures, puis recréez-la avec les bonnes dates.",
    });
    expect(await dates()).toEqual({ s: "2026-08-25", e: "2027-07-05" });

    // Closures still inside, on the very bounds: accepted.
    expect((await edit("2026-08-25", "2027-07-05")).ok).toBe(true);
    await admin`DELETE FROM closure WHERE season_id = ${season2026} AND label = 'Zz Gala'`;
    expect((await edit("2026-08-20", "2027-06-30")).ok).toBe(true);
    expect(await dates()).toEqual({ s: "2026-08-20", e: "2027-06-30" });
  });

  it("refuses a season edit racing a closure being added on the last day (#194)", async () => {
    // Season now 2026-08-20 → 2027-06-30. Two transactions, two connections: A adds a closure on the
    // last day and keeps its transaction open; B shortens the season by one day meanwhile.
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    let added = () => {};
    const isAdded = new Promise<void>((r) => (added = r));
    const a = withSchool(school, async (tx) => {
      const r = await addClosure(tx, season2026, {
        scope: "school",
        label: "Zz Dernier jour",
        start: "2027-06-30",
        end: "2027-06-30",
      });
      added();
      await held;
      return r;
    });
    await isAdded;
    const b = withSchool(school, (tx) =>
      updateSeason(tx, season2026, { label: "2026-2027", startDate: "2026-08-20", endDate: "2027-06-29" }, TODAY),
    );
    // Without the lock, B would not see A's uncommitted closure and would go through.
    await new Promise((r) => setTimeout(r, 300));
    release();
    expect((await a).ok).toBe(true);
    expect(await b).toEqual({
      ok: false,
      message:
        "Cette fermeture sortirait de la saison : Zz Dernier jour (le 30/06/2027). Supprimez-la dans Planning › Fermetures, puis recréez-la avec les bonnes dates.",
    });
    const [s] = await admin`SELECT end_date::text AS e FROM season WHERE id = ${season2026}`;
    expect(s.e).toBe("2027-06-30");
  });
});

describe("disciplines", () => {
  it("creates, rejects a case-insensitive duplicate, renames", async () => {
    const r = await withSchool(school, (tx) => createDiscipline(tx, "Jazz"));
    jazz = r.ok ? r.id : "";
    expect(await withSchool(school, (tx) => createDiscipline(tx, " jazz "))).toEqual({
      ok: false,
      message: "Cette discipline existe déjà.",
    });
    expect((await withSchool(school, (tx) => createDiscipline(tx, "Hip-hop"))).ok).toBe(true);
    expect(await withSchool(school, (tx) => renameDiscipline(tx, jazz, "Hip-hop"))).toEqual({
      ok: false,
      message: "Cette discipline existe déjà.",
    });
    expect((await withSchool(school, (tx) => renameDiscipline(tx, jazz, "Modern’jazz"))).ok).toBe(true);
    // The other school's « Jazz » discipline is neither seen nor in the way.
    expect((await withSchool(school, (tx) => listDisciplines(tx))).map((d) => d.name)).toEqual([
      "Hip-hop",
      "Modern’jazz",
    ]);
  });
});

describe("sites and rooms", () => {
  it("creates a site and its rooms, lists them, updates a room", async () => {
    const s = await withSchool(school, (tx) =>
      createSite(tx, { name: "Centre", address: "1 rue Test", permanence: true }),
    );
    center = s.ok ? s.id : "";
    const r = await withSchool(school, (tx) => createRoom(tx, { siteId: center, name: "Studio", capacity: 20 }));
    studio = r.ok ? r.id : "";
    await withSchool(school, (tx) => createRoom(tx, { siteId: center, name: "Annexe", capacity: null }));
    expect(
      await withSchool(school, (tx) => updateRoom(tx, studio, { siteId: center, name: "Grand studio", capacity: 25 })),
    ).toEqual({ ok: true, id: studio });
    expect(await withSchool(school, (tx) => listPlaces(tx))).toMatchObject([
      {
        name: "Centre",
        permanence: true,
        rooms: [
          { name: "Annexe", capacity: null },
          { name: "Grand studio", capacity: 25, course: 0 },
        ],
      },
    ]);
  });

  it("refuses to remove a room with courses, a site with rooms, or a discipline in use", async () => {
    const [p] =
      await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${school}, 'Prof', 'Camille', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${school}, ${season2026}, ${jazz}, ${studio}, ${p.id}, 3, '17:00', 60)`;
    expect(await withSchool(school, (tx) => deleteRoom(tx, studio))).toEqual({
      ok: false,
      message: "Des cours ont lieu dans Grand studio : déplacez-les d’abord.",
    });
    expect(await withSchool(school, (tx) => deleteSite(tx, center))).toEqual({
      ok: false,
      message: "Centre a encore des salles : retirez-les d’abord.",
    });
    expect(await withSchool(school, (tx) => deleteDiscipline(tx, jazz))).toEqual({
      ok: false,
      message: "Modern’jazz est utilisée (1 cours, 0 tarif) : retirez-les d’abord.",
    });
  });

  it("removes an unused room, rejects a room or site from another school", async () => {
    const annex = (await withSchool(school, (tx) => listPlaces(tx)))[0].rooms.find((s) => s.name === "Annexe")
      ?.id as string;
    expect(await withSchool(school, (tx) => deleteRoom(tx, annex))).toEqual({ ok: true, id: annex });
    expect(await withSchool(otherSchool, (tx) => deleteRoom(tx, studio))).toEqual({
      ok: false,
      message: "Cette salle n’existe plus.",
    });
    expect(
      await withSchool(otherSchool, (tx) => createRoom(tx, { siteId: center, name: "Intrus", capacity: null })),
    ).toEqual({
      ok: false,
      message: "Site introuvable.",
    });
  });
});

describe("site opening hours (#90)", () => {
  it("saves, replaces and reads back a site's opening hours", async () => {
    const week = [1, 2, 3, 4, 5].map((j) => ({ weekday: j, opening: "16:30", closure: "22:00" }));
    expect(await withSchool(school, (tx) => saveHours(tx, center, week))).toEqual({ ok: true, id: center });
    await withSchool(school, (tx) => saveHours(tx, center, [{ weekday: 6, opening: "09:00", closure: "13:00" }]));
    expect((await withSchool(school, (tx) => hoursBySite(tx)))[center]).toEqual([
      { weekday: 6, opening: "09:00", closure: "13:00" },
    ]);
    expect((await withSchool(school, (tx) => listPlaces(tx))).find((l) => l.id === center)?.hours).toHaveLength(1);
  });

  it("rejects a duplicate day, a closing time before opening, and a site from another school", async () => {
    expect(
      await withSchool(school, (tx) =>
        saveHours(tx, center, [
          { weekday: 1, opening: "09:00", closure: "12:00" },
          { weekday: 1, opening: "14:00", closure: "18:00" },
        ]),
      ),
    ).toEqual({ ok: false, message: "Un même jour est saisi deux fois." });
    expect(
      await withSchool(school, (tx) => saveHours(tx, center, [{ weekday: 2, opening: "18:00", closure: "09:00" }])),
    ).toEqual({
      ok: false,
      message: "L’heure de fermeture doit suivre l’ouverture.",
    });
    expect(await withSchool(otherSchool, (tx) => saveHours(tx, center, []))).toEqual({
      ok: false,
      message: "Ce site n’existe plus.",
    });
    expect(await withSchool(otherSchool, (tx) => hoursBySite(tx))).toEqual({});
  });
});
