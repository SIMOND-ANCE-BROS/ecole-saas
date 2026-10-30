import postgres from "postgres";
import { withDefaultQuarters } from "./season-quarters.integration-helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { enrollmentPreview } from "./enrollments";
import {
  saveLessonPack,
  saveSiblings,
  savePrice,
  seasonGrid,
  readSiblings,
  listLessonPacks,
  deleteLessonPack,
} from "./tariffs";
import { schoolWithDefaultEntity } from "./billing-entity.integration-helpers";

/** Tariff grid, siblings and lesson packs (#80), as the app does (app_user, RLS). Fake data deleted at the end. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let otherSchool: string;
let season: string;
let zumba: string;
let zumbaCourse: string;
let ines: string;
let payer: string;

const price = (s: Parameters<typeof savePrice>[2]) => withSchool(school, (tx) => savePrice(tx, season, s));

// Enrolled before the season's first quarter: a quarterly enrollment covers its three quarters (#291).
const ENROLLED_ON = "2026-09-15";

beforeAll(async () => {
  [{ id: school }] = await schoolWithDefaultEntity(admin, "École A", `ta-${suffix}`);
  [{ id: otherSchool }] = await schoolWithDefaultEntity(admin, "École B", `tb-${suffix}`);
  [{ id: season }] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  await withDefaultQuarters(admin, season);
  [{ id: zumba }] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Zumba') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Centre', '1 rue Test') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Studio') RETURNING id`;
  const [p] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${school}, 'Prof', 'Lucas', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  [{ id: zumbaCourse }] =
    await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${school}, (SELECT id FROM billing_entity WHERE school_id = ${school} AND is_default), ${season}, ${zumba}, ${room.id}, ${p.id}, 1, '19:00', 60) RETURNING id`;
  // A student paid for by a third party (relationship « paie pour »); only students are enrolled (#314).
  [{ id: ines }] =
    await admin`INSERT INTO person (school_id, last_name, first_name, birth_date, is_student) VALUES (${school}, 'Moreau', 'Inès', '1992-07-14', true) RETURNING id`;
  [{ id: payer }] =
    await admin`INSERT INTO person (school_id, last_name, company_name, type, siren) VALUES (${school}, 'CSE', 'CSE Ateliers', 'organisation', '123456789') RETURNING id`;
  await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for) VALUES (${school}, ${payer}, ${ines}, 'other', true)`;
});

afterAll(async () => {
  for (const t of [
    "enrollment_course",
    "enrollment",
    "lesson_pack_tariff",
    "discount",
    "tariff",
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

describe("tariff grid", () => {
  it("saves prices, sorts the combination, distinguishes a row restricted to one discipline", async () => {
    await price({
      audience: "adult",
      combination: [60],
      disciplineId: null,
      period: "quarter",
      priceCents: 12000,
    });
    await price({ audience: "adult", combination: [60], disciplineId: null, period: "year", priceCents: 30500 });
    await price({
      audience: "adult",
      combination: [90, 60],
      disciplineId: null,
      period: "quarter",
      priceCents: 24000,
    });
    await price({
      audience: "adult",
      combination: [60, 60],
      disciplineId: zumba,
      period: "quarter",
      priceCents: 19000,
    });
    await price({
      audience: "child",
      combination: [45],
      disciplineId: null,
      period: "quarter",
      priceCents: 8500,
    });
    // Correcting a price: the cell is updated, not duplicated.
    await price({
      audience: "adult",
      combination: [60],
      disciplineId: null,
      period: "quarter",
      priceCents: 12500,
    });

    const grid = await withSchool(school, (tx) => seasonGrid(tx, season));
    expect(
      grid.map(
        (l) =>
          `${l.audience} ${l.combination.join("+")} ${l.discipline ?? "toutes"} T${l.price.quarter?.cents ?? "-"} A${l.price.year?.cents ?? "-"}`,
      ),
    ).toEqual([
      "child 45 toutes T8500 A-",
      "adult 60 toutes T12500 A30500",
      "adult 60+90 toutes T24000 A-",
      "adult 60+60 Zumba T19000 A-",
    ]);
  });

  it("the tariff engine uses the entered price", async () => {
    const r = await withSchool(school, (tx) =>
      enrollmentPreview(
        tx,
        payer,
        season,
        {
          studentIds: [ines],
          audience: "adult",
          period: "quarter",
          courseIds: [zumbaCourse],
        },
        ENROLLED_ON,
      ),
    );
    expect(r).toMatchObject({ status: "ok", newEnrollments: [{ price: { status: "ok", grossPriceCents: 12500 } }] });
  });

  it("removes an unused cell, refuses to remove a cell already used by an enrollment", async () => {
    expect(
      (
        await price({
          audience: "adult",
          combination: [60],
          disciplineId: null,
          period: "year",
          priceCents: null,
        })
      ).ok,
    ).toBe(true);
    const [{ id: tariffId }] =
      await admin`SELECT id FROM tariff WHERE season_id = ${season} AND audience = 'adult' AND period = 'quarter' AND combination = '{60}'`;
    await admin`INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, tariff_id, audience, period, gross_price_cents)
      VALUES (${school}, (SELECT id FROM billing_entity WHERE school_id = ${school} AND is_default), ${season}, ${payer}, ${tariffId}, 'adult', 'quarter', 12500)`;
    expect(
      await price({
        audience: "adult",
        combination: [60],
        disciplineId: null,
        period: "quarter",
        priceCents: null,
      }),
    ).toEqual({
      ok: false,
      message: "Ce prix sert déjà à des inscriptions : modifiez-le plutôt que de le retirer.",
    });
    // Changing its price is still possible: the enrollment keeps its own.
    expect(
      (
        await price({
          audience: "adult",
          combination: [60],
          disciplineId: null,
          period: "quarter",
          priceCents: 13000,
        })
      ).ok,
    ).toBe(true);
    const row = (await withSchool(school, (tx) => seasonGrid(tx, season))).find(
      (l) => l.audience === "adult" && l.combination.join() === "60" && !l.disciplineId,
    );
    expect(row?.price.quarter).toMatchObject({ cents: 13000, used: true });
  });

  it("rejects an empty combination, and a discipline or season from another school", async () => {
    expect(
      await price({
        audience: "adult",
        combination: [],
        disciplineId: null,
        period: "quarter",
        priceCents: 100,
      }),
    ).toEqual({
      ok: false,
      message: "Indiquez au moins un cours",
    });
    const [{ id: otherDiscipline }] =
      await admin`INSERT INTO discipline (school_id, name) VALUES (${otherSchool}, 'Salsa') RETURNING id`;
    expect(
      await price({
        audience: "adult",
        combination: [60],
        disciplineId: otherDiscipline,
        period: "quarter",
        priceCents: 100,
      }),
    ).toEqual({
      ok: false,
      message: "Discipline introuvable.",
    });
    expect(await withSchool(otherSchool, (tx) => seasonGrid(tx, season))).toEqual([]);
  });
});

describe("siblings and lesson packs", () => {
  it("saves, updates and removes the siblings rule; rejects both a rate and an amount", async () => {
    const rule = {
      rateBps: 1000,
      amountCents: null,
      minStudents: 2,
      audiences: ["child" as const],
      combinableWithMultiDiscipline: false,
    };
    expect((await withSchool(school, (tx) => saveSiblings(tx, season, rule))).ok).toBe(true);
    await withSchool(school, (tx) => saveSiblings(tx, season, { ...rule, rateBps: 1500 }));
    expect(await withSchool(school, (tx) => readSiblings(tx, season))).toMatchObject({
      rateBps: 1500,
      audiences: ["child"],
    });
    expect(await withSchool(school, (tx) => saveSiblings(tx, season, { ...rule, amountCents: 1000 }))).toEqual({
      ok: false,
      message: "Indiquez un pourcentage ou un montant, pas les deux.",
    });
    await withSchool(school, (tx) => saveSiblings(tx, season, null));
    expect(await withSchool(school, (tx) => readSiblings(tx, season))).toBeNull();
  });

  it("creates, updates and removes a lesson pack", async () => {
    const r = await withSchool(school, (tx) =>
      saveLessonPack(tx, season, { lessonCount: 5, maxPeople: 1, priceCents: 25000 }),
    );
    await withSchool(school, (tx) => saveLessonPack(tx, season, { lessonCount: 5, maxPeople: 1, priceCents: 24000 }));
    expect(await withSchool(school, (tx) => listLessonPacks(tx, season))).toMatchObject([
      { lessonCount: 5, maxPeople: 1, priceCents: 24000 },
    ]);
    expect(await withSchool(otherSchool, (tx) => deleteLessonPack(tx, r.ok ? r.id : ""))).toEqual({
      ok: false,
      message: "Ce carnet n’existe plus.",
    });
    expect((await withSchool(school, (tx) => deleteLessonPack(tx, r.ok ? r.id : ""))).ok).toBe(true);
  });
});
