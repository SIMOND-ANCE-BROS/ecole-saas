import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { packsOf, sellLessonPack, type SaleInput } from "./lesson-packs";
import { balanceOf } from "./payments";
import { once, storedLessonPack } from "./submissions";

/**
 * Selling a lesson pack (#286), as the application runs it (app_user, RLS).
 * Fictitious data deleted at the end; the audit log being append-only, the
 * cleanup disables its trigger for the duration of an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const frontDesk = `carnet-accueil-${suffix}`;
const TODAY = "2026-11-02";
let school: string;
let otherSchool: string;
let parent: string;
let child: string;
let sibling: string;
let stranger: string;
let foreign: string;

const insertPerson = async (schoolId: string, lastName: string, isStudent: boolean) =>
  (
    await admin`INSERT INTO person (school_id, last_name, first_name, is_student)
      VALUES (${schoolId}, ${lastName}, 'Zzprénom', ${isStudent}) RETURNING id`
  )[0].id as string;

beforeAll(async () => {
  [{ id: school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École A', ${`lpa-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École B', ${`lpb-${suffix}`}) RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${frontDesk}, 'Zz Accueil', ${`${frontDesk}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${frontDesk}, 'front_desk')`;
  const [s] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  await admin`INSERT INTO lesson_pack_tariff (school_id, season_id, lesson_count, max_people, price_cents)
    VALUES (${school}, ${s.id}, 10, 1, 40000), (${school}, ${s.id}, 5, 2, 25000)`;
  parent = await insertPerson(school, "Zzparent", false);
  child = await insertPerson(school, "Zzenfant", true);
  sibling = await insertPerson(school, "Zzfrère", true);
  stranger = await insertPerson(school, "Zzautre", true);
  foreign = await insertPerson(otherSchool, "Zzailleurs", true);
  for (const student of [child, sibling])
    await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for)
      VALUES (${school}, ${parent}, ${student}, 'legal_guardian', true)`;
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of [
    "submission",
    "lesson_pack_person",
    "lesson_pack",
    "lesson_pack_tariff",
    "relationship",
    "season",
    "person",
    "member",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM "user" WHERE id = ${frontDesk}`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

const sale = (s: Partial<SaleInput> = {}): SaleInput => ({
  lessonCount: 10,
  peopleCount: 1,
  participantIds: [child],
  priceCents: 40000,
  reason: "",
  ...s,
});
const sell = (s: Partial<SaleInput> = {}, payer = parent) =>
  withSchool(school, (tx) => sellLessonPack(tx, frontDesk, payer, sale(s), TODAY));
const auditOf = async (id: string) =>
  (await admin`SELECT actor, action, after FROM audit_log WHERE target_table = 'lesson_pack' AND row_id = ${id}`)[0];

describe("selling a lesson pack", () => {
  it("stores the pack at the grid price and raises the payer's balance by it", async () => {
    const before = (await withSchool(school, (tx) => balanceOf(tx, parent, TODAY)))?.remaining ?? 0;
    const r = await sell();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [pack] = await admin`SELECT payer_id, lesson_count, people_count, price_cents, purchased_on::text
      FROM lesson_pack WHERE id = ${r.id}`;
    expect(pack).toEqual({
      payer_id: parent,
      lesson_count: 10,
      people_count: 1,
      price_cents: 40000,
      purchased_on: TODAY,
    });
    const after = await withSchool(school, (tx) => balanceOf(tx, parent, TODAY));
    expect(after?.remaining).toBe(before + 40000);
    const audit = await auditOf(r.id);
    expect(audit.action).toBe("insert");
    expect(audit.after).toEqual({
      payerId: parent,
      participantIds: [child],
      lessonCount: 10,
      peopleCount: 1,
      priceCents: 40000,
      gridPriceCents: 40000,
    });
  });

  it("lists the pack on the payer's and the student's records, with its remaining lessons", async () => {
    const r = await sell({ lessonCount: 5, peopleCount: 2, participantIds: [child, sibling], priceCents: 25000 });
    if (!r.ok) throw new Error(r.message);
    for (const personId of [parent, child, sibling]) {
      const packs = await withSchool(school, (tx) => packsOf(tx, { personId }));
      expect(packs.find((p) => p.id === r.id)).toMatchObject({
        lessonCount: 5,
        peopleCount: 2,
        usedCount: 0,
        payerId: parent,
        participants: expect.arrayContaining([
          expect.objectContaining({ id: child }),
          expect.objectContaining({ id: sibling }),
        ]),
      });
    }
    expect(await withSchool(school, (tx) => packsOf(tx, { personId: stranger }))).toEqual([]);
  });

  it("refuses a price apart from the grid without a reason, and logs the reason when given", async () => {
    expect(await sell({ priceCents: 36000 })).toEqual({
      ok: false,
      message: "Le prix diffère de la grille : indiquez le motif.",
    });
    const r = await sell({ priceCents: 36000, reason: " Zz devis remise " });
    if (!r.ok) throw new Error(r.message);
    expect((await auditOf(r.id)).after).toMatchObject({
      priceCents: 36000,
      gridPriceCents: 40000,
      reason: "Zz devis remise",
    });
  });

  it("requires a price when the grid has no line for the pack (quote)", async () => {
    expect(await sell({ lessonCount: 7, priceCents: null })).toEqual({
      ok: false,
      message: "Aucun tarif pour ce carnet : saisissez le prix.",
    });
    const r = await sell({ lessonCount: 7, priceCents: 30000 });
    if (!r.ok) throw new Error(r.message);
    expect((await auditOf(r.id)).after).toMatchObject({ priceCents: 30000, gridPriceCents: null });
  });

  it("refuses a student the payer does not pay for, and a person of another school", async () => {
    for (const id of [stranger, foreign]) {
      const r = await sell({ participantIds: [id] });
      expect(r).toEqual({
        ok: false,
        message: "Cette personne ne paie pas pour cet élève : ajoutez le lien « paie pour » sur sa fiche.",
      });
    }
  });

  it("lets an adult student buy a pack for themselves", async () => {
    const r = await sell({ participantIds: [stranger] }, stranger);
    expect(r.ok).toBe(true);
  });

  it("creates one pack when the same sale is sent twice after a lost response (#260)", async () => {
    const key = randomUUID();
    const send = () =>
      withSchool(school, (tx) =>
        once(tx, "lesson_pack", key, { payerId: parent, entry: sale() }, storedLessonPack, () =>
          sellLessonPack(tx, frontDesk, parent, sale(), TODAY),
        ),
      );
    const first = await send();
    const second = await send();
    expect(second).toEqual(first);
    if (!first.ok) throw new Error(first.message);
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM lesson_pack WHERE id = ${first.id}`;
    expect(n).toBe(1);
  });
});

describe("lesson_pack_person isolation", () => {
  it("is invisible from another school", async () => {
    const r = await sell();
    if (!r.ok) throw new Error(r.message);
    const rows = await withSchool(otherSchool, (tx) => packsOf(tx, { personId: child }));
    expect(rows).toEqual([]);
    const seen = await withSchool(otherSchool, async (tx) =>
      (await tx.execute(`SELECT count(*)::int AS n FROM lesson_pack_person`)).at(0),
    );
    expect(seen).toEqual({ n: 0 });
  });

  it("refuses a participant of another school (composite foreign key)", async () => {
    const r = await sell();
    if (!r.ok) throw new Error(r.message);
    await expect(
      admin`INSERT INTO lesson_pack_person (school_id, lesson_pack_id, person_id) VALUES (${school}, ${r.id}, ${foreign})`,
    ).rejects.toThrow(/lesson_pack_person_person_same_school_fk/);
  });
});
