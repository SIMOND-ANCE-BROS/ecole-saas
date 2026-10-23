import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCalendarToken, calendarState, readCalendar, revokeCalendarToken } from "./agenda";
import { readInstructor, updateInstructor } from "./intervenants";
import { withSchool } from "./index";

/** Abonnement iCal d'un intervenant, comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let otherSchool: string;
let camille: string;
let ines: string;

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ga-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`gb-${suffix}`}) RETURNING id`;
  const [season] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Jazz') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Centre', '1 rue Test') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Studio') RETURNING id`;
  const teacher = async (firstName: string) =>
    (
      await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
        VALUES (${school}, 'Prof', ${firstName}, 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`
    )[0].id as string;
  camille = await teacher("Camille");
  ines = await teacher("Inès");
  const [c] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes, level)
    VALUES (${school}, ${season.id}, ${d.id}, ${room.id}, ${camille}, 3, '17:00', 60, 'Débutant') RETURNING id`;
  await admin`INSERT INTO lesson (school_id, course_id, date, instructor_id, status) VALUES
    (${school}, ${c.id}, '2026-10-14', ${camille}, 'effectuee'),
    (${school}, ${c.id}, '2026-11-04', ${camille}, 'prevue'),
    (${school}, ${c.id}, '2026-11-18', ${ines}, 'prevue'),
    (${school}, ${c.id}, '2026-11-25', ${camille}, 'annulee')`;
});

afterAll(async () => {
  for (const t of ["lesson", "course", "instructor", "room", "site", "discipline", "season"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  }
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("abonnement iCal", () => {
  it("crée un jeton dont seule l’empreinte est gardée, et donne les séances à venir sans le remplacement", async () => {
    const token = await withSchool(school, (tx) => createCalendarToken(tx, camille));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [{ calendar_token_hash: jeton_agenda_hash }] =
      await admin`SELECT calendar_token_hash FROM instructor WHERE id = ${camille}`;
    expect(jeton_agenda_hash).not.toBe(token);
    expect(jeton_agenda_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await withSchool(school, (tx) => calendarState(tx, camille))).toBeInstanceOf(Date);

    const calendar = await withSchool(school, (tx) => readCalendar(tx, token as string, "2026-10-20"));
    expect(calendar?.name).toBe("Cours de Camille, École A");
    expect(calendar?.lessons.map((s) => `${s.date} ${s.title} ${s.annulee}`)).toEqual([
      "2026-11-04 Jazz Débutant false",
      "2026-11-25 Jazz Débutant true",
    ]);
    expect(calendar?.lessons[0]).toMatchObject({
      startTime: "17:00",
      durationMinutes: 60,
      place: "Studio, Centre, 1 rue Test",
    });
  });

  it("donne au remplaçant la séance qu’il assure", async () => {
    const token = await withSchool(school, (tx) => createCalendarToken(tx, ines));
    expect(
      (await withSchool(school, (tx) => readCalendar(tx, token as string, "2026-10-20")))?.lessons.map((s) => s.date),
    ).toEqual(["2026-11-18"]);
  });

  it("refuse un jeton d’une autre école, un jeton inconnu, et un jeton remplacé ou révoqué", async () => {
    const old = (await withSchool(school, (tx) => createCalendarToken(tx, camille))) as string;
    expect(await withSchool(otherSchool, (tx) => readCalendar(tx, old, "2026-10-20"))).toBeNull();
    expect(await withSchool(school, (tx) => readCalendar(tx, "x".repeat(43), "2026-10-20"))).toBeNull();
    expect(await withSchool(school, (tx) => readCalendar(tx, "court", "2026-10-20"))).toBeNull();

    const next = (await withSchool(school, (tx) => createCalendarToken(tx, camille))) as string;
    expect(await withSchool(school, (tx) => readCalendar(tx, old, "2026-10-20"))).toBeNull();
    expect(await withSchool(school, (tx) => revokeCalendarToken(tx, camille))).toBe(true);
    expect(await withSchool(school, (tx) => readCalendar(tx, next, "2026-10-20"))).toBeNull();
    expect(await withSchool(school, (tx) => calendarState(tx, camille))).toBeNull();
  });

  it("coupe le lien d’un intervenant désactivé, même remis en base à la main", async () => {
    const token = (await withSchool(school, (tx) => createCalendarToken(tx, ines))) as string;
    const record = await withSchool(school, (tx) => readInstructor(tx, ines));
    if (!record) throw new Error("intervenant introuvable");
    const { id, ...saisie } = record;
    expect(id).toBe(ines);
    await withSchool(school, (tx) => updateInstructor(tx, ines, { ...saisie, active: false }));
    expect(await withSchool(school, (tx) => calendarState(tx, ines))).toBeNull();

    // Même si l'empreinte revenait (restauration de sauvegarde), un inactif ne lit rien.
    const [{ empreinte }] = await admin`SELECT encode(sha256(${token}::bytea), 'hex') AS empreinte`;
    await admin`UPDATE instructor SET calendar_token_hash = ${empreinte} WHERE id = ${ines}`;
    expect(await withSchool(school, (tx) => readCalendar(tx, token, "2026-10-20"))).toBeNull();
  });
});
