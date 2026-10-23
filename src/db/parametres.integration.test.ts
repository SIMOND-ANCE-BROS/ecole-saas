import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
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
} from "./parametres";

/** Paramètres de l'école (#80), comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

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
    "season",
  ]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  }
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("saisons", () => {
  it("crée une saison, refuse un libellé pris, des dates inversées ou qui chevauchent", async () => {
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

  it("reprend la grille, les réductions et les carnets de la saison précédente", async () => {
    await admin`INSERT INTO tariff (school_id, season_id, audience, period, combination, price_cents)
      VALUES (${school}, ${season2026}, 'enfant', 'trimestre', '{60}', 11000), (${school}, ${season2026}, 'adulte', 'annee', '{60,90}', 61500)`;
    await admin`INSERT INTO discount (school_id, season_id, code, rate_bps, min_students, audiences, combinable_with_multi_discipline)
      VALUES (${school}, ${season2026}, 'fratrie', 1000, 2, '{enfant}', false)`;
    await admin`INSERT INTO lesson_pack_tariff (school_id, season_id, lesson_count, max_people, price_cents) VALUES (${school}, ${season2026}, 5, 1, 25000)`;
    const r = await withSchool(school, (tx) =>
      createSeason(tx, { label: "2027-2028", startDate: "2027-09-01", endDate: "2028-06-30" }, season2026),
    );
    const id = r.ok ? r.id : "";
    const [{ tarifs }] = await admin`SELECT count(*)::int AS tarifs FROM tariff WHERE season_id = ${id}`;
    const [{ fratrie }] =
      await admin`SELECT rate_bps AS fratrie FROM discount WHERE season_id = ${id} AND code = 'fratrie'`;
    const [{ carnets }] = await admin`SELECT count(*)::int AS carnets FROM lesson_pack_tariff WHERE season_id = ${id}`;
    expect({ tariffs: tarifs, siblings: fratrie, lessonPacks: carnets }).toEqual({
      tariffs: 2,
      siblings: 1000,
      lessonPacks: 1,
    });
    expect((await withSchool(school, (tx) => listSeasons(tx))).map((s) => `${s.label} ${s.tariffs}`)).toEqual([
      "2027-2028 2",
      "2026-2027 2",
    ]);
  });

  it("modifie les dates d’une saison, sans chevaucher l’autre", async () => {
    const saisie = { label: "2026-2027", startDate: "2026-08-25", endDate: "2027-07-05" };
    expect((await withSchool(school, (tx) => updateSeason(tx, season2026, saisie))).ok).toBe(true);
    expect(
      await withSchool(school, (tx) => updateSeason(tx, season2026, { ...saisie, endDate: "2027-09-15" })),
    ).toEqual({
      ok: false,
      message: "Ces dates chevauchent la saison 2027-2028.",
    });
  });
});

describe("disciplines", () => {
  it("crée, refuse un doublon sans tenir compte de la casse, renomme", async () => {
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
    // La discipline « Jazz » de l'autre école n'est ni vue ni gênante.
    expect((await withSchool(school, (tx) => listDisciplines(tx))).map((d) => d.name)).toEqual([
      "Hip-hop",
      "Modern’jazz",
    ]);
  });
});

describe("sites et salles", () => {
  it("crée un site et ses salles, les liste, modifie une salle", async () => {
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
        salles: [
          { name: "Annexe", capacity: null },
          { name: "Grand studio", capacity: 25, course: 0 },
        ],
      },
    ]);
  });

  it("refuse de retirer une salle qui a des cours, un site qui a des salles, une discipline utilisée", async () => {
    const [p] =
      await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${school}, 'Prof', 'Camille', 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`;
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

  it("retire une salle inutilisée, refuse une salle ou un site d’une autre école", async () => {
    const annex = (await withSchool(school, (tx) => listPlaces(tx)))[0].salles.find((s) => s.name === "Annexe")
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

describe("horaires des sites (#90)", () => {
  it("enregistre, remplace et relit les horaires d'un site", async () => {
    const week = [1, 2, 3, 4, 5].map((j) => ({ weekday: j, opening: "16:30", closure: "22:00" }));
    expect(await withSchool(school, (tx) => saveHours(tx, center, week))).toEqual({ ok: true, id: center });
    await withSchool(school, (tx) => saveHours(tx, center, [{ weekday: 6, opening: "09:00", closure: "13:00" }]));
    expect((await withSchool(school, (tx) => hoursBySite(tx)))[center]).toEqual([
      { weekday: 6, opening: "09:00", closure: "13:00" },
    ]);
    expect((await withSchool(school, (tx) => listPlaces(tx))).find((l) => l.id === center)?.hours).toHaveLength(1);
  });

  it("refuse un jour en double, une fermeture avant l'ouverture, un site d'une autre école", async () => {
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
