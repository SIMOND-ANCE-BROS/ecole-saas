import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schoolWithDefaultEntity, treatmentFor } from "./billing-entity.integration-helpers";
import { withSchool } from "./index";
import { PAID_DRAFT } from "./invoice-draft-discard";
import { draftPayerInvoices } from "./invoice-drafts";

/**
 * Invoice drafts (#302) against the real database, run as the application (app_user, RLS):
 * one draft per business, persisted without number, drafted again in place of the unsent one,
 * and the triggers freezing an issued invoice, its lines and its installments. Fictitious data
 * deleted at the end, the immutability triggers disabled inside an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const ids = {} as Record<string, string>;

beforeAll(async () => {
  [{ id: ids.school }] = await schoolWithDefaultEntity(admin, "Zz École factures", `zzfac-${suffix}`);
  const s = ids.school;
  [{ id: ids.a, default_vat_treatment_id: ids.exempt }] =
    await admin`SELECT id, default_vat_treatment_id FROM billing_entity WHERE school_id = ${s} AND is_default`;
  ids.vat20 = await treatmentFor(admin, s, 2000);
  [{ id: ids.b }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, default_vat_treatment_id)
    VALUES (${s}, 'Zz Entreprise B', 'Zz Entreprise B', 'vat_registered', ${ids.vat20}) RETURNING id`;
  [{ id: ids.season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${s}, '2027-2028', '2027-09-01', '2028-06-30') RETURNING id`;
  for (const [key, start, end] of [
    ["q1", "2027-10-01", "2027-12-31"],
    ["q2", "2028-01-01", "2028-03-31"],
    ["q3", "2028-04-01", "2028-06-30"],
  ])
    [{ id: ids[key] }] = await admin`INSERT INTO season_quarter (school_id, season_id, label, start_date, end_date)
      VALUES (${s}, ${ids.season}, ${`Zz ${key}`}, ${start}, ${end}) RETURNING id`;
  [{ id: ids.jazz }] = await admin`INSERT INTO discipline (school_id, name) VALUES (${s}, 'Zz Jazz') RETURNING id`;
  const [site] = await admin`INSERT INTO site (school_id, name, address) VALUES (${s}, 'Zz Site', 'Zz') RETURNING id`;
  [{ id: ids.room }] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${s}, ${site.id}, 'Zz Salle') RETURNING id`;
  [{ id: ids.teacher }] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${s}, 'Zzprof', 'Zz', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  for (const [key, entity, treatment] of [
    ["courseA", ids.a, ids.exempt],
    ["courseB", ids.b, ids.vat20],
  ])
    [{ id: ids[key] }] = await admin`
      INSERT INTO course (school_id, season_id, billing_entity_id, vat_treatment_id, discipline_id, room_id, instructor_id,
        weekday, start_time, duration_minutes)
      VALUES (${s}, ${ids.season}, ${entity}, ${treatment}, ${ids.jazz}, ${ids.room}, ${ids.teacher}, 3, '17:00', 60)
      RETURNING id`;
  [{ id: ids.payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${s}, 'Zzfamille', 'Zzparent') RETURNING id`;
  [{ id: ids.student }] = await admin`INSERT INTO person (school_id, last_name, first_name, is_student)
    VALUES (${s}, 'Zzfamille', 'Zzalice', true) RETURNING id`;
  // A yearly enrollment of business A with a siblings discount, a quarterly one of business B.
  [{ id: ids.yearly }] = await admin`
    INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, enrolled_on,
      gross_price_cents, discount_cents, discounts)
    VALUES (${s}, ${ids.a}, ${ids.season}, ${ids.payer}, 'child', 'year', '2027-09-10', 40000, 4000, '{fratrie}') RETURNING id`;
  [{ id: ids.quarterly }] = await admin`
    INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, enrolled_on, gross_price_cents)
    VALUES (${s}, ${ids.b}, ${ids.season}, ${ids.payer}, 'child', 'quarter', '2027-11-15', 12000) RETURNING id`;
  await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id) VALUES
    (${s}, ${ids.a}, ${ids.yearly}, ${ids.student}, ${ids.courseA}),
    (${s}, ${ids.b}, ${ids.quarterly}, ${ids.student}, ${ids.courseB})`;
  await admin`INSERT INTO enrollment_quarter (school_id, enrollment_id, quarter_id) VALUES
    (${s}, ${ids.quarterly}, ${ids.q1}), (${s}, ${ids.quarterly}, ${ids.q2}), (${s}, ${ids.quarterly}, ${ids.q3})`;
  [{ id: ids.pack }] = await admin`
    INSERT INTO lesson_pack (school_id, billing_entity_id, payer_id, people_count, lesson_count, price_cents, purchased_on)
    VALUES (${s}, ${ids.a}, ${ids.payer}, 1, 5, 20000, '2027-09-20') RETURNING id`;
  // Bought before the season starts: on no draft of this season.
  await admin`
    INSERT INTO lesson_pack (school_id, billing_entity_id, payer_id, people_count, lesson_count, price_cents, purchased_on)
    VALUES (${s}, ${ids.a}, ${ids.payer}, 1, 1, 5000, '2027-07-15')`;
});

afterAll(async () => {
  const s = ids.school;
  await admin.begin(async (t) => {
    for (const [table, trigger] of [
      ["invoice", "invoice_issued_immutable"],
      ["invoice_line", "invoice_line_immutable"],
      ["installment", "installment_immutable"],
      ["audit_log", "audit_log_append_only"],
      ["payment", "payment_immutable"],
    ])
      await t.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
    for (const table of ["payment_allocation", "invoice_line", "installment", "invoice", "audit_log", "payment"])
      await t.unsafe(`DELETE FROM ${table} WHERE school_id = $1`, [s]);
    for (const [table, trigger] of [
      ["invoice", "invoice_issued_immutable"],
      ["invoice_line", "invoice_line_immutable"],
      ["installment", "installment_immutable"],
      ["audit_log", "audit_log_append_only"],
      ["payment", "payment_immutable"],
    ])
      await t.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
  });
  for (const t of [
    "enrollment_quarter",
    "enrollment_course",
    "enrollment",
    "lesson_pack",
    "course",
    "season_quarter",
    "person",
    "instructor",
    "discipline",
    "room",
    "site",
    "season",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [s]);
  await admin`DELETE FROM school WHERE id = ${s}`;
  await admin.end();
});

const draft = () => withSchool(ids.school, (tx) => draftPayerInvoices(tx, null, ids.payer, ids.season));
const invoices = () =>
  admin`SELECT * FROM invoice WHERE school_id = ${ids.school} ORDER BY billing_entity_id = ${ids.a} DESC, created_at`;

describe("draftPayerInvoices (#302)", () => {
  it("drafts one invoice per business, unnumbered, with its lines and installments", async () => {
    const r = await draft();
    expect(r).toMatchObject({ ok: true, invoiceIds: expect.any(Array) });
    const rows = await invoices();
    expect(rows.map((i) => [i.billing_entity_id, i.status, i.number, i.season_id, i.total_incl_tax_cents])).toEqual([
      [ids.a, "to_send", null, ids.season, 40000 - 4000 + 20000],
      [ids.b, "to_send", null, ids.season, 36000],
    ]);
    const [a, b] = rows;
    const linesA = await admin`SELECT label, incl_tax_cents, vat_cents, vat_mention, enrollment_id, lesson_pack_id
      FROM invoice_line WHERE invoice_id = ${a.id} ORDER BY incl_tax_cents DESC`;
    expect(linesA.map((l) => [l.label, l.incl_tax_cents, l.vat_cents])).toEqual([
      ["Forfait 1 h 00 — Zzalice Zzfamille", 40000, 0],
      ["Carnet 5 séances · 1 personne", 20000, 0],
      ["Remise", -4000, 0],
    ]);
    expect(linesA.every((l) => l.vat_mention === "Zz mention")).toBe(true);
    const [lineB] = await admin`SELECT * FROM invoice_line WHERE invoice_id = ${b.id}`;
    expect(lineB).toMatchObject({
      quantity_thousandths: 3000,
      unit_price_cents: 12000,
      incl_tax_cents: 36000,
      vat_cents: 6000,
      excl_tax_cents: 30000,
      vat_category: "standard",
      vat_rate_bps: 2000,
    });
    expect(b.total_vat_cents).toBe(6000);
    // The yearly package and the pack of A get no installment until #176 is decided.
    const installments = await admin`SELECT invoice_id, rank, due_date::text AS due, amount_cents FROM installment
      WHERE school_id = ${ids.school} ORDER BY invoice_id = ${a.id} DESC, rank`;
    expect(installments.map((i) => [i.invoice_id === a.id ? "A" : "B", i.rank, i.due, i.amount_cents])).toEqual([
      ["B", 1, "2027-11-15", 12000],
      ["B", 2, "2028-01-01", 12000],
      ["B", 3, "2028-04-01", 12000],
    ]);
  });

  it("drafting again replaces the unsent drafts instead of adding to them", async () => {
    const before = (await invoices()).map((i) => i.id);
    expect(await draft()).toMatchObject({ ok: true });
    const after = await invoices();
    expect(after).toHaveLength(2);
    expect(after.map((i) => i.id).some((id) => before.includes(id))).toBe(false);
  });

  it("a second unsent draft for the same payer, business and season is refused", async () => {
    await expect(
      admin`INSERT INTO invoice (school_id, billing_entity_id, payer_id, season_id)
        VALUES (${ids.school}, ${ids.a}, ${ids.payer}, ${ids.season})`,
    ).rejects.toThrow(/invoice_one_draft/);
  });

  it("a draft never carries a number; an issued invoice always does", async () => {
    const [a] = await invoices();
    await expect(admin`UPDATE invoice SET number = 'Zz-1' WHERE id = ${a.id}`).rejects.toThrow(/invoice_number_status/);
    await expect(admin`UPDATE invoice SET status = 'issued' WHERE id = ${a.id}`).rejects.toThrow(
      /invoice_number_status/,
    );
  });

  it("leaves out a lesson pack bought outside the season's dates", async () => {
    const lines =
      await admin`SELECT lesson_pack_id FROM invoice_line WHERE school_id = ${ids.school} AND lesson_pack_id IS NOT NULL`;
    expect(lines.map((l) => l.lesson_pack_id)).toEqual([ids.pack]);
  });

  it("refuses to draft again once a payment is allocated to a draft's installment", async () => {
    const [, b] = await invoices();
    const [{ id: inst }] = await admin`SELECT id FROM installment WHERE invoice_id = ${b.id} AND rank = 1`;
    [{ id: ids.payment }] = await admin`
      INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, date)
      VALUES (${ids.school}, ${ids.b}, ${ids.payer}, 12000, 'cash', '2027-11-15') RETURNING id`;
    await admin`INSERT INTO payment_allocation (school_id, billing_entity_id, payment_id, installment_id, amount_cents)
      VALUES (${ids.school}, ${ids.b}, ${ids.payment}, ${inst}, 12000)`;
    expect(await draft()).toEqual({ ok: false, message: PAID_DRAFT });
    expect((await invoices()).map((i) => i.id)).toContain(b.id);
    await admin`DELETE FROM payment_allocation WHERE payment_id = ${ids.payment}`;
  });

  describe("once issued", () => {
    beforeAll(async () => {
      const [a] = await invoices();
      ids.issued = a.id;
      // Its installment written before issuing, as a school's plan (#176) will write it.
      [{ id: ids.issuedInstallment }] = await admin`
        INSERT INTO installment (school_id, billing_entity_id, invoice_id, rank, due_date, amount_cents)
        VALUES (${ids.school}, ${ids.a}, ${a.id}, 1, '2027-09-10', 56000) RETURNING id`;
      // As the invoicing tool's return will write it (#304): its number and its date.
      await admin`UPDATE invoice SET status = 'issued', number = 'Zz-A-1', issued_on = '2027-11-20', tool_ref = 'zz'
        WHERE id = ${a.id}`;
      [{ id: ids.issuedLine }] = await admin`SELECT id FROM invoice_line WHERE invoice_id = ${a.id} LIMIT 1`;
    });

    it("updating or deleting an issued invoice fails; its PDF link may be filled in", async () => {
      await expect(admin`UPDATE invoice SET total_incl_tax_cents = 1 WHERE id = ${ids.issued}`).rejects.toThrow(
        /issued invoice cannot be modified/,
      );
      await expect(admin`DELETE FROM invoice WHERE id = ${ids.issued}`).rejects.toThrow(/cannot be deleted/);
      await expect(
        admin`UPDATE invoice SET pdf_url = 'https://zz.test/a.pdf' WHERE id = ${ids.issued}`,
      ).resolves.toBeDefined();
    });

    it("updating, adding or deleting a line of an issued invoice fails", async () => {
      await expect(admin`UPDATE invoice_line SET label = 'Zz' WHERE id = ${ids.issuedLine}`).rejects.toThrow(
        /invoice_line of an issued invoice/,
      );
      await expect(admin`DELETE FROM invoice_line WHERE id = ${ids.issuedLine}`).rejects.toThrow(/issued invoice/);
      await expect(
        admin`INSERT INTO invoice_line (school_id, billing_entity_id, invoice_id, label, unit_price_cents,
          incl_tax_cents, excl_tax_cents, vat_cents, vat_treatment_id, vat_category, vat_mention)
        VALUES (${ids.school}, ${ids.a}, ${ids.issued}, 'Zz', 100, 100, 100, 0, ${ids.exempt}, 'exempt', 'Zz')`,
      ).rejects.toThrow(/issued invoice/);
    });

    it("an installment of an issued invoice keeps its amount and date; only its status changes", async () => {
      await expect(admin`UPDATE installment SET amount_cents = 1 WHERE id = ${ids.issuedInstallment}`).rejects.toThrow(
        /installment of an issued invoice/,
      );
      await expect(admin`DELETE FROM installment WHERE id = ${ids.issuedInstallment}`).rejects.toThrow(
        /issued invoice/,
      );
      await expect(
        admin`UPDATE installment SET status = 'paid' WHERE id = ${ids.issuedInstallment}`,
      ).resolves.toBeDefined();
    });

    it("drafting again leaves the issued invoice and what it bills alone", async () => {
      // A new enrollment of business A after the issued invoice: drafted alone.
      const s = ids.school;
      const [{ id }] = await admin`
        INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, enrolled_on, gross_price_cents)
        VALUES (${s}, ${ids.a}, ${ids.season}, ${ids.payer}, 'child', 'year', '2027-12-01', 30000) RETURNING id`;
      await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id)
        VALUES (${s}, ${ids.a}, ${id}, ${ids.student}, ${ids.courseA})`;
      expect(await draft()).toMatchObject({ ok: true });
      const rows = await admin`SELECT id, status, total_incl_tax_cents FROM invoice
        WHERE school_id = ${s} AND billing_entity_id = ${ids.a} ORDER BY created_at`;
      expect(rows.map((r) => [r.id === ids.issued, r.status, r.total_incl_tax_cents])).toEqual([
        [true, "issued", 56000],
        [false, "to_send", 30000],
      ]);
    });
  });
});
