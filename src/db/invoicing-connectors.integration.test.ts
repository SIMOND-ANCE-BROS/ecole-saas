import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { inSimulation } from "./invoicing-connectors";
import { defaultEntityFor } from "./billing-entity.integration-helpers";

/**
 * Simulation tool (#303), against the real database: a « TEST- » number is
 * refused on an invoice of a real tool and the fake tool gives no other number;
 * « Mode simulation » follows the school's own active connectors (RLS).
 * Fictitious data, deleted at the end (no invoice is issued, so the immutability
 * triggers never get in the way).
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let otherSchool: string;
let entity: string;
let otherEntity: string;
let payer: string;

beforeAll(async () => {
  [{ id: school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École S', ${`sim-a-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École T', ${`sim-b-${suffix}`}) RETURNING id`;
  entity = await defaultEntityFor(admin, school, "Zz Danse S");
  otherEntity = await defaultEntityFor(admin, otherSchool, "Zz Danse T");
  [{ id: payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzpayeur', 'Zoé') RETURNING id`;
});

afterAll(async () => {
  await admin`DELETE FROM invoice WHERE school_id IN (${school}, ${otherSchool})`;
  await admin`DELETE FROM invoicing_connector WHERE school_id IN (${school}, ${otherSchool})`;
  await admin`DELETE FROM person WHERE school_id IN (${school}, ${otherSchool})`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

const insertInvoice = (tool: string | null, number: string) =>
  admin`INSERT INTO invoice (school_id, billing_entity_id, payer_id, status, tool, number)
        VALUES (${school}, ${entity}, ${payer}, 'tool_draft', ${tool}, ${number})`;

describe("fake tool numbers", () => {
  it("accepts a « TEST- » number from the fake tool", async () => {
    await expect(insertInvoice("fake", `TEST-F-${suffix}`)).resolves.toBeDefined();
  });

  it("refuses a « TEST- » number on a real tool or with no tool", async () => {
    await expect(insertInvoice("abby", `TEST-F-${suffix}-1`)).rejects.toThrow(/invoice_fake_number/);
    await expect(insertInvoice(null, `TEST-F-${suffix}-2`)).rejects.toThrow(/invoice_fake_number/);
  });

  it("refuses any other number from the fake tool", async () => {
    await expect(insertInvoice("fake", `F-${suffix}`)).rejects.toThrow(/invoice_fake_number/);
  });

  it("leaves real numbers of real tools alone", async () => {
    await expect(insertInvoice("pennylane", `F-${suffix}`)).resolves.toBeDefined();
  });
});

describe("simulation mode", () => {
  it("is on only while the school's own business has an active fake connector", async () => {
    expect(await withSchool(school, inSimulation)).toBe(false);
    await admin`INSERT INTO invoicing_connector (school_id, billing_entity_id, tool, encrypted_credentials)
                VALUES (${otherSchool}, ${otherEntity}, 'fake', 'zz-chiffre')`;
    expect(await withSchool(school, inSimulation)).toBe(false);
    expect(await withSchool(otherSchool, inSimulation)).toBe(true);
    await admin`INSERT INTO invoicing_connector (school_id, billing_entity_id, tool, encrypted_credentials, active)
                VALUES (${school}, ${entity}, 'fake', 'zz-chiffre', false)`;
    expect(await withSchool(school, inSimulation)).toBe(false);
    await admin`UPDATE invoicing_connector SET active = true WHERE billing_entity_id = ${entity}`;
    expect(await withSchool(school, inSimulation)).toBe(true);
  });
});
