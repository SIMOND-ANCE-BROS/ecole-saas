import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cancelEnrollment,
  enrollmentPreview,
  type EnrollmentInput,
  saveEnrollment,
  seasonEnrollments,
} from "./enrollments";
import { withSchool } from "./index";
import { balanceOf } from "./payments";
import { createSeason, listSeasons, saveSeasonQuarters, updateSeason, type QuarterEntry } from "./settings";
import { seasonFigures } from "./dashboard";
import { schoolWithDefaultEntity } from "./billing-entity.integration-helpers";

/**
 * Season quarters (#291), run as the application (app_user, RLS): default quarters of a new
 * season, their edition, the quarters a quarterly enrollment covers and what it then owes.
 * Fictitious data deleted at the end, the audit log included.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const frontDesk = `zz-accueil-trimestres-${suffix}`;
const ids = {} as Record<string, string>;
const SEASON = { label: "2027-2028", startDate: "2027-09-01", endDate: "2028-06-30" };

beforeAll(async () => {
  [{ id: ids.school }] = await schoolWithDefaultEntity(admin, "Zz École trimestres", `zztr-${suffix}`);
  [{ id: ids.other }] = await schoolWithDefaultEntity(admin, "Zz Autre école", `zztr2-${suffix}`);
  const s = ids.school;
  [{ id: ids.entity }] = await admin`SELECT id FROM billing_entity WHERE school_id = ${s} AND is_default`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${frontDesk}, 'Zz Compte', ${`${frontDesk}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${s}, ${frontDesk}, 'front_desk')`;
  const created = await withSchool(s, (tx) => createSeason(tx, SEASON, null));
  if (!created.ok) throw new Error(created.message);
  ids.season = created.id;
  // A season whose quarters were all removed: no quarterly enrollment.
  [{ id: ids.bare }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${s}, 'Zz sans trimestres', '2029-09-01', '2030-06-30') RETURNING id`;
  for (const season of [ids.season, ids.bare])
    for (const period of ["quarter", "year"])
      await admin`INSERT INTO tariff (school_id, season_id, audience, period, combination, price_cents)
        VALUES (${s}, ${season}, 'child', ${period}, '{60}'::smallint[], ${period === "quarter" ? 11000 : 30000})`;
  await admin`INSERT INTO discount (school_id, season_id, code, rate_bps, min_students, audiences, combinable_with_multi_discipline)
    VALUES (${s}, ${ids.season}, 'fratrie', 1000, 2, '{child}', false)`;
  const [site] = await admin`INSERT INTO site (school_id, name, address) VALUES (${s}, 'Zz Site', 'Zz') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${s}, ${site.id}, 'Zz Salle') RETURNING id`;
  const [instructor] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${s}, 'Zzprof', 'Zz', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  const [jazz] = await admin`INSERT INTO discipline (school_id, name) VALUES (${s}, 'Zzjazz') RETURNING id`;
  for (const [key, season] of [
    ["jazz", ids.season],
    ["bareJazz", ids.bare],
  ])
    [{ id: ids[key] }] =
      await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${s}, ${ids.entity}, ${season}, ${jazz.id}, ${room.id}, ${instructor.id}, 1, '17:00', 60) RETURNING id`;
  for (const [key, first] of [
    ["payer", "Zzparent"],
    ["zoe", "Zzzoé"],
    ["noe", "Zznoé"],
    ["lea", "Zzléa"],
    ["tom", "Zztom"],
    ["eve", "Zzève"],
    ["ugo", "Zzugo"],
  ] as const) {
    [{ id: ids[key] }] =
      await admin`INSERT INTO person (school_id, last_name, first_name, is_student) VALUES (${s}, 'Zzfamille', ${first}, ${key !== "payer"}) RETURNING id`;
    if (key !== "payer")
      await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for) VALUES (${s}, ${ids.payer}, ${ids[key]}, 'legal_guardian', true)`;
  }
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id = ${ids.school}`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  await admin`DELETE FROM school WHERE id IN (${ids.school}, ${ids.other})`;
  await admin`DELETE FROM "user" WHERE id = ${frontDesk}`;
  await admin.end();
});

const child = (studentId: string, extra: Partial<EnrollmentInput> = {}): EnrollmentInput => ({
  studentIds: [studentId],
  audience: "child",
  period: "quarter",
  courseIds: [ids.jazz],
  ...extra,
});
const save = (entry: EnrollmentInput, today: string, season = ids.season) =>
  withSchool(ids.school, (tx) => saveEnrollment(tx, frontDesk, ids.payer, season, entry, today));
const coveredBy = async (enrollmentId: string) =>
  (
    await admin`SELECT q.label FROM enrollment_quarter e JOIN season_quarter q ON q.id = e.quarter_id
      WHERE e.enrollment_id = ${enrollmentId} ORDER BY q.start_date`
  ).map((r) => r.label as string);
const quartersOf = async () =>
  (await withSchool(ids.school, (tx) => listSeasons(tx))).find((s) => s.id === ids.season)!.quarters;
const entries = (quarters: Awaited<ReturnType<typeof quartersOf>>): QuarterEntry[] =>
  quarters.map((q) => ({ id: q.id, label: q.label, startDate: q.startDate, endDate: q.endDate }));

describe("season quarters (#291)", () => {
  it("a new season gets three quarters, October–December, January–March and April–June", async () => {
    expect((await quartersOf()).map(({ id: _id, ...q }) => q)).toEqual([
      { label: "1er trimestre", startDate: "2027-10-01", endDate: "2027-12-31" },
      { label: "2e trimestre", startDate: "2028-01-01", endDate: "2028-03-31" },
      { label: "3e trimestre", startDate: "2028-04-01", endDate: "2028-06-30" },
    ]);
  });

  it("another school sees none of them (RLS)", async () => {
    const seen = await withSchool(ids.other, (tx) => tx.execute(sql`SELECT id FROM season_quarter`));
    expect(seen).toHaveLength(0);
  });

  it("refuses overlapping quarters or a quarter outside the season, saving nothing", async () => {
    const before = await quartersOf();
    const [q1, q2, q3] = entries(before);
    const overlap = await withSchool(ids.school, (tx) =>
      saveSeasonQuarters(tx, ids.season, [q1, { ...q2, startDate: "2027-12-15" }, q3]),
    );
    expect(overlap).toEqual({
      ok: false,
      message: "Les trimestres « 1er trimestre » et « 2e trimestre » se chevauchent.",
    });
    const outside = await withSchool(ids.school, (tx) =>
      saveSeasonQuarters(tx, ids.season, [q1, q2, { ...q3, endDate: "2028-07-14" }]),
    );
    expect(outside).toMatchObject({ ok: false, message: expect.stringMatching(/sort de la saison/) });
    expect(await quartersOf()).toEqual(before);
  });

  it("renames, moves, adds and removes quarters not covered by an enrollment", async () => {
    const [q1, q2, q3] = entries(await quartersOf());
    const r = await withSchool(ids.school, (tx) =>
      saveSeasonQuarters(tx, ids.season, [
        { ...q1, label: "Automne", startDate: "2027-09-15" },
        q2,
        { ...q3, endDate: "2028-05-31" },
        { id: null, label: "Juin", startDate: "2028-06-01", endDate: "2028-06-30" },
      ]),
    );
    expect(r).toEqual({ ok: true, id: ids.season });
    const now = await quartersOf();
    expect(now.map((q) => [q.label, q.startDate, q.endDate])).toEqual([
      ["Automne", "2027-09-15", "2027-12-31"],
      ["2e trimestre", "2028-01-01", "2028-03-31"],
      ["3e trimestre", "2028-04-01", "2028-05-31"],
      ["Juin", "2028-06-01", "2028-06-30"],
    ]);
    // Back to the three default quarters: « Juin » removed, nothing covers it.
    const back = await withSchool(ids.school, (tx) =>
      saveSeasonQuarters(tx, ids.season, [{ ...q1, startDate: "2027-10-01" }, q2, { ...q3, endDate: "2028-06-30" }]),
    );
    expect(back).toEqual({ ok: true, id: ids.season });
    expect((await quartersOf()).map((q) => q.label)).toEqual(["1er trimestre", "2e trimestre", "3e trimestre"]);
  });
});

describe("quarterly enrollments (#291)", () => {
  it("enrolled in September: the three quarters, 330,00 € due on the balance", async () => {
    const r = await save(child(ids.zoe), "2027-09-15");
    if (!r.ok) throw new Error(r.message);
    expect(await coveredBy(r.id)).toEqual(["1er trimestre", "2e trimestre", "3e trimestre"]);
    expect((await admin`SELECT to_char(enrolled_on, 'YYYY-MM-DD') AS d FROM enrollment WHERE id = ${r.id}`)[0].d).toBe(
      "2027-09-15",
    );
    expect(await withSchool(ids.school, (tx) => balanceOf(tx, ids.payer, "2027-09-15"))).toMatchObject({
      due: 33000,
    });
  });

  it("issue example: enrolled on 2028-01-10 → two quarters; the siblings discount taken off each one", async () => {
    const p = await withSchool(ids.school, (tx) =>
      enrollmentPreview(tx, ids.payer, ids.season, child(ids.noe), "2028-01-10"),
    );
    if (p.status !== "ok") throw new Error(p.message);
    expect(p.quarters.map((q) => q.label)).toEqual(["2e trimestre", "3e trimestre"]);
    const r = await save(child(ids.noe), "2028-01-10");
    if (!r.ok) throw new Error(r.message);
    expect(await coveredBy(r.id)).toEqual(["2e trimestre", "3e trimestre"]);
    // 110,00 € − 10 % siblings = 99,00 € a quarter, two quarters.
    const listed = await withSchool(ids.school, (tx) => seasonEnrollments(tx, { payerId: ids.payer }, ids.season));
    expect(listed.find((e) => e.id === r.id)).toMatchObject({
      netPriceCents: 9900,
      quarters: ["2e trimestre", "3e trimestre"],
      quarterCount: 2,
      seasonDueCents: 19800,
    });
    expect(await withSchool(ids.school, (tx) => balanceOf(tx, ids.payer, "2028-01-10"))).toMatchObject({
      due: 33000 + 19800,
    });
  });

  it("enrolled in the middle of a quarter: that quarter counts in full (#291 Q1 default)", async () => {
    const r = await save(child(ids.lea), "2027-11-15");
    if (!r.ok) throw new Error(r.message);
    expect(await coveredBy(r.id)).toEqual(["1er trimestre", "2e trimestre", "3e trimestre"]);
  });

  it("enrolled after the last quarter started: that quarter only", async () => {
    const r = await save(child(ids.tom), "2028-05-02");
    if (!r.ok) throw new Error(r.message);
    expect(await coveredBy(r.id)).toEqual(["3e trimestre"]);
  });

  it("a yearly enrollment covers no quarter and owes its price once", async () => {
    const r = await save(child(ids.eve, { period: "year" }), "2027-09-15");
    if (!r.ok) throw new Error(r.message);
    expect(await coveredBy(r.id)).toEqual([]);
    const listed = await withSchool(ids.school, (tx) => seasonEnrollments(tx, { payerId: ids.payer }, ids.season));
    expect(listed.find((e) => e.id === r.id)).toMatchObject({ quarterCount: 0, seasonDueCents: 27000 });
  });

  it("the dashboard total counts each covered quarter", async () => {
    const figures = await withSchool(ids.school, (tx) => seasonFigures(tx, ids.season));
    const rows = await admin`SELECT net_price_cents AS net, period,
        (SELECT count(*)::int FROM enrollment_quarter q WHERE q.enrollment_id = e.id) AS quarters
      FROM enrollment e WHERE season_id = ${ids.season} AND status = 'active'`;
    const expected = rows.reduce((t, r) => t + r.net * (r.period === "quarter" ? r.quarters : 1), 0);
    expect(figures.netTotalCents).toBe(expected);
    expect(expected).toBeGreaterThan(rows.reduce((t, r) => t + r.net, 0));
  });

  it("refuses a quarterly enrollment once no quarter is left, or in a season without quarters, saving nothing", async () => {
    const count = async () =>
      (await admin`SELECT count(*)::int AS n FROM enrollment WHERE school_id = ${ids.school}`)[0].n as number;
    const before = await count();
    expect(await save(child(ids.ugo), "2028-07-01")).toEqual({
      ok: false,
      message: "Plus aucun trimestre de la saison n’est à venir : choisissez l’année ou une autre formule.",
    });
    expect(await save(child(ids.ugo, { courseIds: [ids.bareJazz] }), "2029-09-15", ids.bare)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Paramètres › Saisons/),
    });
    expect(await count()).toBe(before);
    // A yearly enrollment stays possible in a season without quarters.
    expect(
      await save(child(ids.ugo, { courseIds: [ids.bareJazz], period: "year" }), "2029-09-15", ids.bare),
    ).toMatchObject({ ok: true });
  });

  it("a quarter covered by an enrollment cannot be removed, only changed", async () => {
    const [q1, q2] = entries(await quartersOf());
    const r = await withSchool(ids.school, (tx) => saveSeasonQuarters(tx, ids.season, [q1, q2]));
    expect(r).toEqual({
      ok: false,
      message:
        "Le trimestre « 3e trimestre » est payé par des inscriptions : il ne peut pas être supprimé, seulement modifié.",
    });
    expect(await quartersOf()).toHaveLength(3);
  });

  it("new season dates leaving a quarter outside are refused, naming it", async () => {
    const r = await withSchool(ids.school, (tx) =>
      updateSeason(tx, ids.season, { ...SEASON, endDate: "2028-06-15" }, "2027-09-01"),
    );
    expect(r).toEqual({
      ok: false,
      message:
        "Ce trimestre sortirait de la saison : 3e trimestre (du 01/04/2028 au 30/06/2028). Modifiez d’abord les trimestres de la saison.",
    });
  });

  it("cancelling an enrollment removes the quarters it covered", async () => {
    const r = await save(child(ids.ugo), "2027-09-20");
    if (!r.ok) throw new Error(r.message);
    expect(await coveredBy(r.id)).toHaveLength(3);
    expect(await withSchool(ids.school, (tx) => cancelEnrollment(tx, frontDesk, r.id))).toEqual({ ok: true, id: r.id });
    expect(await admin`SELECT 1 FROM enrollment_quarter WHERE enrollment_id = ${r.id}`).toHaveLength(0);
  });
});
