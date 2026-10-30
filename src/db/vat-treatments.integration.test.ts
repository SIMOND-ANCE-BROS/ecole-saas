import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCourse, readCourse, updateCourse, type CourseInput } from "./courses";
import { updateEntity } from "./billing-entities";
import { withSchool } from "./index";
import { sellLessonPack } from "./lesson-packs";
import {
  createTreatment,
  deleteTreatment,
  lastTreatmentByInstructor,
  listTreatments,
  NO_DEFAULT_TREATMENT,
  updateTreatment,
} from "./vat-treatments";
import { schoolWithDefaultEntity, treatmentFor } from "./billing-entity.integration-helpers";

/**
 * VAT treatments of courses and lesson packs (#301), against the real database, run as
 * the application (app_user, RLS): the checks on treatments and invoice lines, the
 * business's regime refusing a VAT rate under the franchise, the default given to new
 * courses and packs. Fictitious data deleted at the end; the audit log being immutable,
 * its rows are deleted with its trigger disabled inside an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const director = `tva-direction-${suffix}`;
const TODAY = "2026-11-02";
const ids = {} as Record<string, string>;

const entityRow = (id: string) => admin`SELECT * FROM billing_entity WHERE id = ${id}`.then(([e]) => e);

beforeAll(async () => {
  [{ id: ids.school }] = await schoolWithDefaultEntity(admin, "Zz École TVA", `zztva-${suffix}`);
  const s = ids.school;
  [{ id: ids.a, default_vat_treatment_id: ids.exempt }] =
    await admin`SELECT id, default_vat_treatment_id FROM billing_entity WHERE school_id = ${s} AND is_default`;
  ids.vat20 = await treatmentFor(admin, s, 2000);
  [{ id: ids.registered }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, default_vat_treatment_id)
    VALUES (${s}, 'Zz Assujettie', 'Zz Assujettie', 'vat_registered', ${ids.exempt}) RETURNING id`;
  [{ id: ids.franchise }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, default_vat_treatment_id)
    VALUES (${s}, 'Zz Franchise', 'Zz Franchise', 'franchise_293b', ${ids.exempt}) RETURNING id`;
  [{ id: ids.otherSchool }] = await schoolWithDefaultEntity(admin, "Zz Autre TVA", `zztvo-${suffix}`);
  await admin`INSERT INTO "user" (id, name, email) VALUES (${director}, 'Zz Direction', ${`${director}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${s}, ${director}, 'director')`;
  [{ id: ids.season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${s}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [site] = await admin`INSERT INTO site (school_id, name, address) VALUES (${s}, 'Zz Site', 'Zz') RETURNING id`;
  [{ id: ids.room }] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${s}, ${site.id}, 'Zz Salle') RETURNING id`;
  for (const key of ["teacher", "taxed"])
    [{ id: ids[key] }] =
      await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${s}, ${`Zz${key}`}, 'Zz', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  [{ id: ids.jazz }] = await admin`INSERT INTO discipline (school_id, name) VALUES (${s}, 'Zzjazz') RETURNING id`;
  [{ id: ids.payer }] = await admin`
    INSERT INTO person (school_id, last_name, first_name, is_student) VALUES (${s}, 'Zzadulte', 'Zz', true) RETURNING id`;
});

afterAll(async () => {
  const schools = [ids.school, ids.otherSchool];
  for (const t of ["lesson_pack_person", "lesson_pack", "invoice_line", "invoice", "course"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, schools);
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${ids.school}, ${ids.otherSchool})`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of ["person", "instructor", "discipline", "room", "site", "season", "member"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, schools);
  await admin`DELETE FROM "user" WHERE id = ${director}`;
  await admin`DELETE FROM school WHERE id IN (${ids.school}, ${ids.otherSchool})`;
  await admin.end();
});

const input = (p: { entity?: string; treatment?: string; instructor?: string } = {}): CourseInput => ({
  discipline: { id: ids.jazz },
  room: { id: ids.room },
  instructorId: p.instructor ?? ids.teacher,
  billingEntityId: p.entity,
  vatTreatmentId: p.treatment,
  type: "group",
  recurrence: "weekly",
  weekday: 6,
  startDate: null,
  endDate: null,
  dates: [],
  startTime: "10:00",
  durationMinutes: 60,
  ageMin: null,
  ageMax: null,
  level: null,
  maxCapacity: null,
  instructorRate: null,
});
const inSchool = <T>(f: Parameters<typeof withSchool<T>>[1]) => withSchool(ids.school, f);
const treatmentOf = async (id: string) => (await inSchool((tx) => readCourse(tx, id)))?.vatTreatmentId;

describe("the database checks", () => {
  it("refuses a VAT rate at 0 %, a rate on an exemption and an exemption without a mention", async () => {
    await expect(
      admin`INSERT INTO vat_treatment (school_id, label, category, rate_bps) VALUES (${ids.school}, 'Zz 0', 'standard', 0)`,
    ).rejects.toThrow(/vat_treatment_rate/);
    await expect(
      admin`INSERT INTO vat_treatment (school_id, label, category, rate_bps, mention)
        VALUES (${ids.school}, 'Zz e', 'exempt', 2000, 'Zz')`,
    ).rejects.toThrow(/vat_treatment_rate/);
    for (const mention of [null, " "])
      await expect(
        admin`INSERT INTO vat_treatment (school_id, label, category, mention) VALUES (${ids.school}, 'Zz m', 'exempt', ${mention})`,
      ).rejects.toThrow(/vat_treatment_mention/);
  });

  it("keeps an invoice line's excl. + VAT equal to its incl. amount, and a mention without VAT", async () => {
    const [inv] = await admin`
      INSERT INTO invoice (school_id, billing_entity_id, payer_id) VALUES (${ids.school}, ${ids.registered}, ${ids.payer}) RETURNING id`;
    const line = (
      incl: number,
      excl: number,
      vat: number,
      treatment: string,
      category: string,
      rate: number,
      mention: string | null,
    ) =>
      admin`INSERT INTO invoice_line (school_id, billing_entity_id, invoice_id, label, unit_price_cents,
          incl_tax_cents, excl_tax_cents, vat_cents, vat_treatment_id, vat_category, vat_rate_bps, vat_mention)
        VALUES (${ids.school}, ${ids.registered}, ${inv.id}, 'Zz', ${incl}, ${incl}, ${excl}, ${vat}, ${treatment}, ${category}, ${rate}, ${mention})`;
    await expect(line(41500, 34583, 6917, ids.vat20, "standard", 2000, null)).resolves.toBeDefined();
    await expect(line(41500, 34583, 6916, ids.vat20, "standard", 2000, null)).rejects.toThrow(/invoice_line_vat_sum/);
    await expect(line(41500, 41500, 0, ids.vat20, "standard", 0, null)).rejects.toThrow(/invoice_line_vat_rate/);
    await expect(line(41500, 41500, 0, ids.exempt, "exempt", 0, null)).rejects.toThrow(/invoice_line_vat_mention/);
    await expect(line(41500, 41500, 0, ids.exempt, "exempt", 0, "Zz mention")).resolves.toBeDefined();
  });

  it("isolates treatments per school (RLS)", async () => {
    const mine = (await inSchool((tx) => listTreatments(tx))).map((t) => t.id);
    const theirs = (await withSchool(ids.otherSchool, (tx) => listTreatments(tx))).map((t) => t.id);
    expect(mine).toEqual(expect.arrayContaining([ids.exempt, ids.vat20]));
    expect(theirs).not.toContain(ids.exempt);
    expect(theirs).toHaveLength(1);
  });
});

describe("managing treatments", () => {
  it("creates a treatment from a rate typed in percent, refuses a taken name and a missing mention", async () => {
    const r = await inSchool((tx) =>
      createTreatment(tx, director, { label: "Zz TVA 5,5", category: "standard", rate: "5,5", mention: "ignorée" }),
    );
    if (!r.ok) throw new Error(r.message);
    const [row] = await admin`SELECT rate_bps, mention FROM vat_treatment WHERE id = ${r.id}`;
    expect(row).toEqual({ rate_bps: 550, mention: null });
    expect(
      await inSchool((tx) =>
        createTreatment(tx, director, { label: "zz tva 5,5", category: "exempt", rate: "", mention: "Zz" }),
      ),
    ).toEqual({ ok: false, message: "Un autre traitement de TVA porte déjà ce nom." });
    expect(
      await inSchool((tx) =>
        createTreatment(tx, director, { label: "Zz exo", category: "exempt", rate: "", mention: " " }),
      ),
    ).toEqual({ ok: false, message: "Mention obligatoire : elle est imprimée sur les lignes de facture sans TVA." });
    // Unused: it can go.
    expect(await inSchool((tx) => deleteTreatment(tx, director, r.id))).toEqual({ ok: true, id: r.id });
  });

  it("keeps a treatment in use, and refuses it a rate while a business without VAT uses it", async () => {
    expect(await inSchool((tx) => deleteTreatment(tx, director, ids.exempt))).toMatchObject({ ok: false });
    expect(
      await inSchool((tx) =>
        updateTreatment(tx, director, ids.exempt, {
          label: "Zz exonéré",
          category: "standard",
          rate: "20",
          mention: "",
        }),
      ),
    ).toEqual({
      ok: false,
      message:
        "Une entreprise sans TVA (franchise en base ou non assujettie) utilise ce traitement : il ne peut pas recevoir de taux.",
    });
    expect((await admin`SELECT category FROM vat_treatment WHERE id = ${ids.exempt}`)[0].category).toBe("exempt");
  });
});

describe("the treatment of a course", () => {
  it("gives a new course its business's default treatment when none is chosen", async () => {
    const r = await inSchool((tx) => createCourse(tx, ids.season, input()));
    if (!r.ok) throw new Error(r.message);
    expect(await treatmentOf(r.id)).toBe(ids.exempt);
  });

  it("refuses a VAT rate to a course of a business that charges no VAT, accepts it for a registered one", async () => {
    for (const entity of [ids.a, ids.franchise])
      expect(await inSchool((tx) => createCourse(tx, ids.season, input({ entity, treatment: ids.vat20 })))).toEqual({
        ok: false,
        message:
          "Cette entreprise ne facture pas de TVA (franchise en base ou non assujettie) : choisissez un traitement sans TVA.",
      });
    const r = await inSchool((tx) =>
      createCourse(tx, ids.season, input({ entity: ids.registered, treatment: ids.vat20, instructor: ids.taxed })),
    );
    if (!r.ok) throw new Error(r.message);
    ids.taxedCourse = r.id;
    expect(await treatmentOf(r.id)).toBe(ids.vat20);
  });

  it("keeps its treatment when edited without one, and refuses a move to a business without VAT", async () => {
    expect(
      await inSchool((tx) =>
        updateCourse(tx, ids.taxedCourse, input({ entity: ids.registered, instructor: ids.teacher })),
      ),
    ).toMatchObject({ ok: true });
    // The instructor changed: the treatment stays the course's (#289 Q2 default).
    expect(await treatmentOf(ids.taxedCourse)).toBe(ids.vat20);
    expect(await inSchool((tx) => updateCourse(tx, ids.taxedCourse, input({ entity: ids.franchise })))).toMatchObject({
      ok: false,
    });
    expect(await treatmentOf(ids.taxedCourse)).toBe(ids.vat20);
  });

  it("proposes each instructor the treatment of their last course", async () => {
    const r = await inSchool((tx) =>
      createCourse(tx, ids.season, input({ entity: ids.registered, treatment: ids.vat20, instructor: ids.taxed })),
    );
    if (!r.ok) throw new Error(r.message);
    const last = await inSchool((tx) => lastTreatmentByInstructor(tx));
    expect(last[ids.taxed]).toBe(ids.vat20);
    expect(last[ids.teacher]).toBe(ids.vat20); // the course taken over above is its latest
  });

  it("counts each treatment's courses", async () => {
    const [{ n: exempt }] =
      await admin`SELECT count(*)::int AS n FROM course WHERE school_id = ${ids.school} AND vat_treatment_id = ${ids.exempt}`;
    const uses = Object.fromEntries((await inSchool((tx) => listTreatments(tx))).map((t) => [t.id, t.uses]));
    expect(exempt).toBeGreaterThan(0);
    // Two courses with the rate, and an invoice line of the checks above each.
    expect(uses).toMatchObject({ [ids.exempt]: exempt + 1, [ids.vat20]: 3 });
  });

  it("refuses a rate to a treatment only a course of a business without VAT uses", async () => {
    const other = await inSchool((tx) =>
      createTreatment(tx, director, { label: "Zz autre exonération", category: "exempt", rate: "", mention: "Zz" }),
    );
    if (!other.ok) throw new Error(other.message);
    const c = await inSchool((tx) =>
      createCourse(tx, ids.season, input({ entity: ids.franchise, treatment: other.id })),
    );
    if (!c.ok) throw new Error(c.message);
    expect(
      await inSchool((tx) =>
        updateTreatment(tx, director, other.id, { label: "Zz autre", category: "standard", rate: "20", mention: "" }),
      ),
    ).toMatchObject({ ok: false });
  });
});

describe("a business's regime", () => {
  const entityEntry = (e: Record<string, unknown>, regime: "franchise_293b" | "vat_registered" | "not_applicable") => ({
    name: String(e.name),
    legalName: String(e.legal_name),
    siren: "",
    siret: "",
    vatNumber: "",
    addressLine: "",
    postalCode: "",
    city: "",
    vatRegime: regime,
    vatMention: "",
    bankAccountLabel: "",
    defaultVatTreatmentId: String(e.default_vat_treatment_id ?? ""),
  });

  it("cannot become one without VAT while its courses carry a rate", async () => {
    const e = await entityRow(ids.registered);
    expect(
      await inSchool((tx) => updateEntity(tx, director, ids.registered, entityEntry(e, "franchise_293b"))),
    ).toEqual({
      ok: false,
      message:
        "Des cours ou des carnets de cette entreprise ont un traitement avec TVA : changez-les avant de passer à un régime sans TVA.",
    });
  });

  it("cannot take a VAT rate as default treatment without VAT", async () => {
    const e = await entityRow(ids.franchise);
    expect(
      await inSchool((tx) =>
        updateEntity(tx, director, ids.franchise, {
          ...entityEntry(e, "franchise_293b"),
          defaultVatTreatmentId: ids.vat20,
        }),
      ),
    ).toMatchObject({ ok: false });
  });
});

describe("the treatment of a lesson pack", () => {
  const sale = { lessonCount: 5, peopleCount: 1, priceCents: 20000, reason: "Zz devis" };

  it("takes its business's default treatment", async () => {
    const r = await inSchool((tx) =>
      sellLessonPack(tx, director, ids.payer, { ...sale, participantIds: [ids.payer], billingEntityId: ids.a }, TODAY),
    );
    if (!r.ok) throw new Error(r.message);
    expect((await admin`SELECT vat_treatment_id FROM lesson_pack WHERE id = ${r.id}`)[0].vat_treatment_id).toBe(
      ids.exempt,
    );
  });

  it("is refused when the business has no default treatment", async () => {
    await admin`UPDATE billing_entity SET default_vat_treatment_id = NULL WHERE id = ${ids.a}`;
    try {
      expect(
        await inSchool((tx) =>
          sellLessonPack(
            tx,
            director,
            ids.payer,
            { ...sale, participantIds: [ids.payer], billingEntityId: ids.a },
            TODAY,
          ),
        ),
      ).toEqual({ ok: false, message: NO_DEFAULT_TREATMENT });
    } finally {
      await admin`UPDATE billing_entity SET default_vat_treatment_id = ${ids.exempt} WHERE id = ${ids.a}`;
    }
  });
});
