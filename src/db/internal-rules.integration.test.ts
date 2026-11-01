import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RULES_LABEL } from "../domain/people/internal-rules";
import { withSchool } from "./index";
import {
  acceptRules,
  addReferralSource,
  currentRulesVersion,
  listReferralSources,
  payersRules,
  referralCounts,
  removeReferralSource,
  removeRulesAcceptance,
  renameReferralSource,
  saveRulesText,
  seasonsRules,
  setReferral,
  setReferralIfNone,
  setRefusesPhotos,
  studentRulesLines,
} from "./internal-rules";
import { listStudents } from "./students";
import { schoolWithDefaultEntity } from "./billing-entity.integration-helpers";

/**
 * Internal rules, photos and « Comment nous avez-vous connus ? » (#296), as
 * the application runs them (app_user, RLS): versions never rewritten, one
 * acceptance per payer and season, the audit log, and the students list.
 * Fictitious data deleted at the end; the audit log being immutable, the
 * cleanup disables its trigger inside an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const TODAY = "2026-10-29";
const suffix = Math.random().toString(36).slice(2, 8);
const desk = `reglement-accueil-${suffix}`;
let school: string;
let otherSchool: string;
let season: string;
let nextSeason: string;
let parent: string; // pays for Zoé (active) and Léo (waitlist)
let zoe: string;
let leo: string;
let foreignPayer: string;

async function person(schoolId: string, firstName: string, birthDate: string | null, isStudent: boolean) {
  const [{ id }] = await admin`INSERT INTO person (school_id, last_name, first_name, birth_date, is_student)
    VALUES (${schoolId}, 'Zzregle', ${firstName}, ${birthDate}, ${isStudent}) RETURNING id`;
  return id as string;
}

beforeAll(async () => {
  [{ id: school }] = await schoolWithDefaultEntity(admin, "École A", `ra-${suffix}`);
  [{ id: otherSchool }] = await schoolWithDefaultEntity(admin, "École B", `rb-${suffix}`);
  await admin`INSERT INTO "user" (id, name, email) VALUES (${desk}, 'Zzfaux Test', ${`${desk}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${desk}, 'front_desk')`;
  parent = await person(school, "Hélène", null, false);
  zoe = await person(school, "Zoé", "2015-03-10", true);
  leo = await person(school, "Léo", "2016-05-01", true);
  foreignPayer = await person(otherSchool, "Inconnue", null, false);
  [{ id: season }] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: nextSeason }] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${school}, '2027-2028', '2027-09-01', '2028-06-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Jazz') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Centre', '1 rue Test') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Studio') RETURNING id`;
  const [teacher] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${school}, 'Roux', 'Mathis', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  const [jazz] =
    await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${school}, (SELECT id FROM billing_entity WHERE school_id = ${school} AND is_default), ${season}, ${d.id}, ${room.id}, ${teacher.id}, 3, '17:00', 60) RETURNING id`;
  for (const [who, status, enrolledOn] of [
    [zoe, "active", "2026-09-07"],
    [leo, "waitlist", "2026-09-10"],
  ] as const) {
    const [i] =
      await admin`INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents, status, enrolled_on)
      VALUES (${school}, (SELECT id FROM billing_entity WHERE school_id = ${school} AND is_default), ${season}, ${parent}, 'child', 'quarter', 10000, ${status}, ${enrolledOn}) RETURNING id`;
    await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id) VALUES (${school}, (SELECT billing_entity_id FROM enrollment WHERE id = ${i.id}), ${i.id}, ${who}, ${jazz.id})`;
  }
  // Léo already danced last season: not a new student of this one.
  const [past] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${school}, '2025-2026', '2025-09-01', '2026-06-30') RETURNING id`;
  const [oldJazz] =
    await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${school}, (SELECT id FROM billing_entity WHERE school_id = ${school} AND is_default), ${past.id}, ${d.id}, ${room.id}, ${teacher.id}, 3, '17:00', 60) RETURNING id`;
  const [old] =
    await admin`INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents, status, enrolled_on)
    VALUES (${school}, (SELECT id FROM billing_entity WHERE school_id = ${school} AND is_default), ${past.id}, ${parent}, 'child', 'quarter', 10000, 'ended', '2025-09-08') RETURNING id`;
  await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id) VALUES (${school}, (SELECT billing_entity_id FROM enrollment WHERE id = ${old.id}), ${old.id}, ${leo}, ${oldJazz.id})`;
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of [
    "rules_acceptance",
    "internal_rules_version",
    "enrollment_course",
    "enrollment",
    "course",
    "instructor",
    "room",
    "site",
    "discipline",
    "season",
    "person",
    "referral_source",
    "member",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM "user" WHERE id = ${desk}`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

const as = <T>(fn: Parameters<typeof withSchool<T>>[1]) => withSchool(school, fn);
const auditOf = (table: string, rowId: string) =>
  admin`SELECT action, before, after, actor IS NOT NULL AS has_actor FROM audit_log
    WHERE school_id = ${school} AND target_table = ${table} AND row_id = ${rowId} ORDER BY id`;
const missing = async () => {
  const rows = await as((tx) => listStudents(tx, "Zzregle", { today: TODAY, seasonId: season }));
  return Object.fromEntries(rows.map((r) => [r.firstName, r.missingDocuments]));
};

describe("rules of a season", () => {
  it("asks no signature while the school recorded no rules for the season", async () => {
    expect(await missing()).toEqual({ Zoé: [], Léo: [] });
    const [line] = await as((tx) => studentRulesLines(tx, zoe, parent, season));
    expect(line).toMatchObject({ enrolled: true, rulesRecorded: false });
  });

  it("keeps every text as a version, saves nothing for the same text, and never rewrites one", async () => {
    expect(await as((tx) => saveRulesText(tx, desk, season, "  "))).toEqual({
      ok: false,
      message: "Indiquez le texte du règlement ou le nom de sa version.",
    });
    expect(await as((tx) => saveRulesText(tx, desk, season, "Version du 29 octobre 2026\r\n"))).toEqual({ ok: true });
    const first = await as((tx) => currentRulesVersion(tx, season));
    expect(first?.text).toBe("Version du 29 octobre 2026");
    expect(await as((tx) => saveRulesText(tx, desk, season, " Version du 29 octobre 2026 "))).toEqual({ ok: true });
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM internal_rules_version WHERE season_id = ${season}`;
    expect(n).toBe(1);
    const audit = await auditOf("internal_rules_version", first?.id ?? "");
    expect(audit).toMatchObject([{ action: "insert", before: null, has_actor: true }]);

    await expect(admin`UPDATE internal_rules_version SET text = 'autre' WHERE id = ${first?.id ?? ""}`).rejects.toThrow(
      /never updated/,
    );
  });

  it("refuses a season of another school", async () => {
    const r = await withSchool(otherSchool, (tx) => saveRulesText(tx, desk, season, "Texte"));
    expect(r).toEqual({ ok: false, message: "Cette saison n’existe plus." });
  });
});

describe("acceptance by a payer", () => {
  it("lists the rules among the missing documents of an enrolled student until the payer signs", async () => {
    // Léo is only on the waiting list: nothing asked of him yet.
    expect(await missing()).toEqual({ Zoé: [RULES_LABEL], Léo: [] });
    const [line] = await as((tx) => studentRulesLines(tx, zoe, parent, season));
    expect(line).toMatchObject({ payerId: parent, enrolled: true, acceptedOn: null, firstEnrolledOn: "2026-09-07" });
  });

  it("records the version signed, corrects the date without changing it, and logs every state", async () => {
    expect(await as((tx) => acceptRules(tx, desk, parent, season, "2026-11-02", TODAY))).toEqual({
      ok: false,
      message: "La date de signature ne peut pas être dans le futur.",
    });
    expect(await as((tx) => acceptRules(tx, desk, parent, season, "2026-09-07", TODAY))).toEqual({ ok: true });
    expect(await missing()).toEqual({ Zoé: [], Léo: [] });
    const version = await as((tx) => currentRulesVersion(tx, season));
    const [row] = await admin`SELECT id, rules_version_id FROM rules_acceptance WHERE payer_id = ${parent}`;
    expect(row.rules_version_id).toBe(version?.id);

    // The school changes its rules: the payer keeps the version signed, said on the record.
    await as((tx) => saveRulesText(tx, desk, season, "Version du 15 novembre 2026"));
    expect(await as((tx) => acceptRules(tx, desk, parent, season, "2026-09-08", TODAY))).toEqual({ ok: true });
    const [after] = await admin`SELECT accepted_on::text, rules_version_id FROM rules_acceptance WHERE id = ${row.id}`;
    expect(after).toEqual({ accepted_on: "2026-09-08", rules_version_id: version?.id });
    const [rules] = await as((tx) => payersRules(tx, [parent], season));
    expect(rules).toMatchObject({ acceptedOn: "2026-09-08", olderVersion: true });

    expect(await as((tx) => removeRulesAcceptance(tx, desk, parent, season))).toEqual({ ok: true });
    expect(await missing()).toEqual({ Zoé: [RULES_LABEL], Léo: [] });
    expect((await auditOf("rules_acceptance", row.id)).map((a) => a.action)).toEqual(["insert", "update", "delete"]);
    expect((await as((tx) => seasonsRules(tx))).find((s) => s.seasonId === season)).toMatchObject({
      text: "Version du 15 novembre 2026",
      versions: 2,
      acceptances: 0,
    });
  });

  it("signs the rules of the season a record shows, never another school's (#362)", async () => {
    // The next season has no rules text: a signature is still kept, apart from the current season's.
    expect(await as((tx) => acceptRules(tx, desk, parent, nextSeason, TODAY, TODAY))).toEqual({ ok: true });
    expect((await as((tx) => payersRules(tx, [parent], nextSeason)))[0]).toMatchObject({ acceptedOn: TODAY });
    expect((await as((tx) => payersRules(tx, [parent], season)))[0]).toMatchObject({ acceptedOn: null });
    expect(await as((tx) => removeRulesAcceptance(tx, desk, parent, nextSeason))).toEqual({ ok: true });
    const [{ id: theirs }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
      VALUES (${otherSchool}, '2027-2028', '2027-09-01', '2028-06-30') RETURNING id`;
    expect(await as((tx) => acceptRules(tx, desk, parent, theirs, TODAY, TODAY))).toEqual({
      ok: false,
      message: "Cette saison n’existe plus.",
    });
  });

  it("refuses a payer of another school, and a version of another season", async () => {
    expect(await as((tx) => acceptRules(tx, desk, foreignPayer, season, TODAY, TODAY))).toEqual({
      ok: false,
      message: "Ce payeur n’existe plus.",
    });
    const version = await as((tx) => currentRulesVersion(tx, season));
    await expect(
      admin`INSERT INTO rules_acceptance (school_id, payer_id, season_id, rules_version_id, accepted_on)
        VALUES (${school}, ${parent}, ${nextSeason}, ${version?.id ?? null}, ${TODAY})`,
    ).rejects.toThrow(/rules_acceptance_rules_version_same_season_fk/);
  });

  it("is invisible to another school", async () => {
    await as((tx) => acceptRules(tx, desk, parent, season, TODAY, TODAY));
    const seen = await withSchool(otherSchool, (tx) => payersRules(tx, [parent], season));
    expect(seen).toEqual([]);
  });
});

describe("photos and « Comment nous avez-vous connus ? »", () => {
  it("notes a refusal of photos, logged, and shows it in the list", async () => {
    expect(await as((tx) => setRefusesPhotos(tx, desk, zoe, true))).toEqual({ ok: true });
    expect(await as((tx) => setRefusesPhotos(tx, desk, parent, true))).toEqual({
      ok: false,
      message: "Cet élève n’existe plus.",
    });
    const rows = await as((tx) => listStudents(tx, "Zzregle", { today: TODAY, seasonId: season }));
    expect(Object.fromEntries(rows.map((r) => [r.firstName, r.photos]))).toEqual({ Zoé: "refusées", Léo: null });
    expect(await auditOf("person", zoe)).toMatchObject([
      { action: "update", before: { refusesPhotos: false }, after: { refusesPhotos: true } },
    ]);
  });

  it("offers the school's answers, refuses duplicates, keeps an answer given", async () => {
    expect(await as((tx) => addReferralSource(tx, desk, "Bouche à oreille"))).toEqual({ ok: true });
    expect(await as((tx) => addReferralSource(tx, desk, "Réseaux"))).toEqual({ ok: true });
    expect(await as((tx) => addReferralSource(tx, desk, " bouche  à OREILLE "))).toEqual({
      ok: false,
      message: "« bouche à OREILLE » est déjà proposée.",
    });
    const [word, networks] = await as((tx) => listReferralSources(tx));
    expect([word.label, networks.label]).toEqual(["Bouche à oreille", "Réseaux"]);

    expect(await as((tx) => setReferral(tx, desk, zoe, word.id))).toEqual({ ok: true });
    // At an enrollment, only the students without an answer get the one chosen.
    expect(await as((tx) => setReferralIfNone(tx, desk, [zoe, leo], networks.id))).toEqual({ ok: true });
    const rows = await as((tx) => listStudents(tx, "Zzregle", { today: TODAY, seasonId: season }));
    expect(Object.fromEntries(rows.map((r) => [r.firstName, r.referral]))).toEqual({
      Zoé: "Bouche à oreille",
      Léo: "Réseaux",
    });

    expect(await as((tx) => removeReferralSource(tx, desk, word.id))).toMatchObject({ ok: false });
    expect(await as((tx) => renameReferralSource(tx, desk, word.id, "Réseaux"))).toMatchObject({ ok: false });
    expect(await as((tx) => renameReferralSource(tx, desk, word.id, "Bouche-à-oreille"))).toEqual({ ok: true });

    const counts = await as((tx) => referralCounts(tx, season));
    expect(counts).toEqual([
      { label: "Bouche-à-oreille", students: 1, newThisSeason: 1 },
      { label: "Réseaux", students: 1, newThisSeason: 0 },
      { label: "Non renseigné", students: 0, newThisSeason: 0 },
    ]);
    expect(await withSchool(otherSchool, (tx) => listReferralSources(tx))).toEqual([]);
  });

  it("removes an answer nobody gave", async () => {
    await as((tx) => addReferralSource(tx, desk, "Enseigne"));
    const sign = (await as((tx) => listReferralSources(tx))).find((s) => s.label === "Enseigne");
    expect(await as((tx) => removeReferralSource(tx, desk, sign?.id ?? ""))).toEqual({ ok: true });
    expect((await as((tx) => listReferralSources(tx))).map((s) => s.label)).toEqual(["Bouche-à-oreille", "Réseaux"]);
  });
});
