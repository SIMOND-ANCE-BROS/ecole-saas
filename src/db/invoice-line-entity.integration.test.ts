import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schoolWithDefaultEntity } from "./billing-entity.integration-helpers";

/**
 * Invoice lines tied to their invoice's billing entity (#318, ADR 0006): an invoice of
 * one business never bills an enrollment or a lesson pack sold by another. Foreign keys
 * are checked whatever the role, so the rows are written as the owner. Fictitious data
 * deleted at the end.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const ids: Record<string, string> = {};

beforeAll(async () => {
  [{ id: ids.school }] = await schoolWithDefaultEntity(admin, "Zz École lignes", `zzl-${suffix}`);
  const s = ids.school;
  [{ id: ids.a }] = await admin`SELECT id FROM billing_entity WHERE school_id = ${s} AND is_default`;
  [{ id: ids.b }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime)
    VALUES (${s}, 'Zz Entreprise B', 'Zz Entreprise B', 'not_applicable') RETURNING id`;
  [{ id: ids.season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${s}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: ids.payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${s}, 'Zzfamille', 'Zzparent') RETURNING id`;
  for (const entity of ["a", "b"]) {
    [{ id: ids[`enrollment-${entity}`] }] = await admin`
      INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents)
      VALUES (${s}, ${ids[entity]}, ${ids.season}, ${ids.payer}, 'child', 'quarter', 11000) RETURNING id`;
    [{ id: ids[`pack-${entity}`] }] = await admin`
      INSERT INTO lesson_pack (school_id, billing_entity_id, payer_id, people_count, lesson_count, price_cents)
      VALUES (${s}, ${ids[entity]}, ${ids.payer}, 1, 5, 20000) RETURNING id`;
    [{ id: ids[`invoice-${entity}`] }] = await admin`
      INSERT INTO invoice (school_id, billing_entity_id, payer_id)
      VALUES (${s}, ${ids[entity]}, ${ids.payer}) RETURNING id`;
  }
});

afterAll(async () => {
  for (const t of ["invoice_line", "invoice", "lesson_pack", "enrollment", "person", "season"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [ids.school]);
  await admin`DELETE FROM school WHERE id = ${ids.school}`;
  await admin.end();
});

/** Inserts a line of `invoice` carrying `entity`, billing `enrollment` or `pack` (or neither). */
const line = (entity: string, invoice: string, refs: { enrollment?: string; pack?: string } = {}) => admin`
  INSERT INTO invoice_line (school_id, billing_entity_id, invoice_id, label, unit_price_cents, enrollment_id, lesson_pack_id)
  VALUES (${ids.school}, ${ids[entity]}, ${ids[invoice]}, 'Zz ligne', 11000,
    ${refs.enrollment ? ids[refs.enrollment] : null}, ${refs.pack ? ids[refs.pack] : null})
  RETURNING id`;

describe("invoice lines and billing entities (#318)", () => {
  it("accepts a line billing an enrollment, a lesson pack or nothing of the invoice's entity", async () => {
    for (const refs of [{ enrollment: "enrollment-a" }, { pack: "pack-a" }, {}])
      await expect(line("a", "invoice-a", refs)).resolves.toHaveLength(1);
  });

  it("refuses an invoice of entity A billing an enrollment of entity B", async () => {
    // The invoice's entity on the line: the enrollment's key refuses it.
    await expect(line("a", "invoice-a", { enrollment: "enrollment-b" })).rejects.toThrow(
      /invoice_line_enrollment_same_entity_fk/,
    );
    // The enrollment's entity on the line: the invoice's key refuses it.
    await expect(line("b", "invoice-a", { enrollment: "enrollment-b" })).rejects.toThrow(
      /invoice_line_invoice_same_entity_fk/,
    );
  });

  it("refuses an invoice of entity A billing a lesson pack of entity B", async () => {
    await expect(line("a", "invoice-a", { pack: "pack-b" })).rejects.toThrow(/invoice_line_lesson_pack_same_entity_fk/);
    await expect(line("b", "invoice-a", { pack: "pack-b" })).rejects.toThrow(/invoice_line_invoice_same_entity_fk/);
  });

  it("refuses to move a billed enrollment or lesson pack to another entity", async () => {
    await expect(
      admin`UPDATE enrollment SET billing_entity_id = ${ids.b} WHERE id = ${ids["enrollment-a"]}`,
    ).rejects.toThrow(/invoice_line_enrollment_same_entity_fk/);
    await expect(
      admin`UPDATE lesson_pack SET billing_entity_id = ${ids.b} WHERE id = ${ids["pack-a"]}`,
    ).rejects.toThrow(/invoice_line_lesson_pack_same_entity_fk/);
  });
});
