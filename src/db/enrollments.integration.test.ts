import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { enrollmentPreview, saveEnrollment, enrollmentsPaidBy } from "./enrollments";
import { seasonCourses } from "./schedule";
import { seasonFigures, lastEnrollments } from "./dashboard";

/** Enrollments, run as the application (app_user, RLS). Fictitious data deleted at the end. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const ids = {} as Record<string, string>;

beforeAll(async () => {
  [{ id: ids.ecole }] = await admin`INSERT INTO school (name, slug) VALUES ('École I', ${`i-${suffix}`}) RETURNING id`;
  const e = ids.ecole;
  [{ id: ids.saison }] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${e}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: ids.autreSaison }] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${e}, '2027-2028', '2027-09-01', '2028-06-30') RETURNING id`;
  for (const [combination, price] of [
    ["{60}", 11000],
    ["{45,60}", 16500],
    ["{60,60}", 18500],
  ] as const) {
    await admin`INSERT INTO tariff (school_id, season_id, audience, period, combination, price_cents)
      VALUES (${e}, ${ids.saison}, 'child', 'quarter', ${combination}::smallint[], ${price})`;
  }
  await admin`INSERT INTO discount (school_id, season_id, code, rate_bps, min_students, audiences, combinable_with_multi_discipline)
    VALUES (${e}, ${ids.saison}, 'fratrie', 1000, 2, '{child}', false)`;
  const [site] = await admin`INSERT INTO site (school_id, name, address) VALUES (${e}, 'Site', 'Adresse') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${e}, ${site.id}, 'Salle') RETURNING id`;
  const [teacher] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${e}, 'Prof', 'Test', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  const [jazz] = await admin`INSERT INTO discipline (school_id, name) VALUES (${e}, 'Jazz') RETURNING id`;
  const [classical] = await admin`INSERT INTO discipline (school_id, name) VALUES (${e}, 'Classique') RETURNING id`;
  const course = async (seasonId: string, disciplineId: string, duration: number, day: number) =>
    (
      await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${e}, ${seasonId}, ${disciplineId}, ${room.id}, ${teacher.id}, ${day}, '17:00', ${duration}) RETURNING id`
    )[0].id as string;
  ids.jazz60 = await course(ids.saison, jazz.id, 60, 1);
  ids.jazz45 = await course(ids.saison, jazz.id, 45, 2);
  ids.classique60 = await course(ids.saison, classical.id, 60, 3);
  ids.autreSaison60 = await course(ids.autreSaison, jazz.id, 60, 1);
  [{ id: ids.payeur }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${e}, 'Famille', 'Test') RETURNING id`;
  [{ id: ids.autrePayeur }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${e}, 'Autre', 'Famille') RETURNING id`;
  [{ id: ids.zoe }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${e}, 'Famille', 'Zoé') RETURNING id`;
  [{ id: ids.noe }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${e}, 'Famille', 'Noé') RETURNING id`;
  [{ id: ids.etranger }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${e}, 'Autre', 'Max') RETURNING id`;
  for (const [payer, student] of [
    [ids.payeur, ids.zoe],
    [ids.payeur, ids.noe],
    [ids.autrePayeur, ids.etranger],
  ]) {
    await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for) VALUES (${e}, ${payer}, ${student}, 'legal_guardian', true)`;
  }
});

afterAll(async () => {
  for (const t of [
    "enrollment_course",
    "enrollment",
    "course",
    "relationship",
    "person",
    "instructor",
    "room",
    "site",
    "discipline",
    "discount",
    "tariff",
    "season",
  ]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [ids.ecole]);
  }
  await admin`DELETE FROM school WHERE id = ${ids.ecole}`;
  await admin.end();
});

const enfant = (studentIds: string[], courseIds: string[]) => ({
  studentIds: studentIds,
  audience: "child" as const,
  period: "quarter" as const,
  courseIds: courseIds,
});
const preview = (entry: ReturnType<typeof enfant>) =>
  withSchool(ids.ecole, (tx) => enrollmentPreview(tx, ids.payeur, ids.saison, entry));
const save = (entry: ReturnType<typeof enfant>) =>
  withSchool(ids.ecole, (tx) => saveEnrollment(tx, ids.payeur, ids.saison, entry));

describe("Inscription", () => {
  it("donne un aperçu du prix pour un premier enfant, sans fratrie", async () => {
    const a = await preview(enfant([ids.zoe], [ids.jazz60]));
    if (a.status !== "ok") throw new Error(a.message);
    expect(a.newEnrollment).toMatchObject({ status: "ok", grossPriceCents: 11000, netPriceCents: 11000 });
  });

  it("enregistre l’inscription au prix recalculé côté serveur", async () => {
    const r = await save(enfant([ids.zoe], [ids.jazz60]));
    if (!r.ok) throw new Error(r.message);
    const [row] =
      await admin`SELECT audience, period, gross_price_cents, discount_cents, net_price_cents, discounts, tariff_id
      FROM enrollment WHERE id = ${r.id}`;
    expect(row).toMatchObject({
      audience: "child",
      period: "quarter",
      gross_price_cents: 11000,
      discount_cents: 0,
      net_price_cents: 11000,
      discounts: [],
    });
    expect(row.tariff_id).toBeTruthy();
    const linkedCourses =
      await admin`SELECT student_id, course_id FROM enrollment_course WHERE enrollment_id = ${r.id}`;
    expect(linkedCourses).toEqual([{ student_id: ids.zoe, course_id: ids.jazz60 }]);
  });

  it("applique la fratrie avec l’inscription déjà enregistrée, et le signale pour elle", async () => {
    const a = await preview(enfant([ids.noe], [ids.jazz60]));
    if (a.status !== "ok") throw new Error(a.message);
    expect(a.newEnrollment).toMatchObject({ grossPriceCents: 11000, discountCents: 1100, netPriceCents: 9900 });
    expect(a.existingImpacts).toHaveLength(1);
    expect(a.existingImpacts[0]).toMatchObject({ students: "Zoé", savedDeposit: 0, recalculatedDiscount: 1100 });
  });

  it("enregistre le second enfant avec la fratrie (deux cours de la même discipline)", async () => {
    const r = await save(enfant([ids.noe], [ids.jazz45, ids.jazz60]));
    if (!r.ok) throw new Error(r.message);
    const [row] = await admin`SELECT gross_price_cents, discount_cents, discounts FROM enrollment WHERE id = ${r.id}`;
    expect(row).toMatchObject({ gross_price_cents: 16500, discount_cents: 1650, discounts: ["fratrie"] });
  });

  it("liste les inscriptions payées par la personne pour la saison", async () => {
    const list = await withSchool(ids.ecole, (tx) => enrollmentsPaidBy(tx, ids.payeur, ids.saison));
    expect(list.map((i) => [i.students, i.netPriceCents])).toEqual([
      ["Noé", 14850],
      ["Zoé", 11000],
    ]);
  });
});

describe("Refus", () => {
  it("refuse un danseur d’un autre payeur", async () => {
    expect(await save(enfant([ids.etranger], [ids.jazz60]))).toMatchObject({ ok: false });
  });

  it("refuse un cours d’une autre saison", async () => {
    expect(await save(enfant([ids.zoe], [ids.autreSaison60]))).toMatchObject({ ok: false });
  });

  it("refuse un couple à un seul danseur", async () => {
    const r = await save({ ...enfant([ids.zoe], [ids.jazz60]), audience: "couple" as never });
    expect(r).toMatchObject({ ok: false, message: "Un couple réunit deux danseurs." });
  });

  it("refuse une combinaison absente de la grille, sans rien enregistrer", async () => {
    const [{ before }] = await admin`SELECT count(*)::int AS before FROM enrollment WHERE school_id = ${ids.ecole}`;
    const r = await save(enfant([ids.zoe], [ids.jazz60, ids.classique60, ids.jazz45]));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toContain("prix à saisir par l’accueil");
    const [{ after }] = await admin`SELECT count(*)::int AS after FROM enrollment WHERE school_id = ${ids.ecole}`;
    expect(typeof before).toBe("number");
    expect(after).toBe(before);
  });
});

describe("Tableau de bord et effectifs", () => {
  it("compte les inscriptions, les danseurs et le montant de la saison", async () => {
    const digits = await withSchool(ids.ecole, (tx) => seasonFigures(tx, ids.saison));
    expect(digits).toEqual({ enrollments: 2, students: 2, netTotalCents: 11000 + 14850 });
  });

  it("liste les dernières inscriptions, la plus récente d’abord", async () => {
    const dernieres = await withSchool(ids.ecole, (tx) => lastEnrollments(tx, ids.saison));
    expect(dernieres.map((d) => [d.students, d.payer, d.netPriceCents])).toEqual([
      ["Noé", "Test Famille", 14850],
      ["Zoé", "Test Famille", 11000],
    ]);
  });

  it("donne l’effectif de chaque cours", async () => {
    const courses = await withSchool(ids.ecole, (tx) => seasonCourses(tx, ids.saison));
    const effective = Object.fromEntries(courses.map((c) => [c.id, c.enrolled]));
    expect(effective).toEqual({ [ids.jazz60]: 2, [ids.jazz45]: 1, [ids.classique60]: 0 });
  });
});
