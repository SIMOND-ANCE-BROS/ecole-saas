import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Tariff grid constraints: a cell (season × audience × periodicity
 * × combination × discipline) exists only once, including for
 * « toutes disciplines » rows (NULL discipline), and a combination is never empty.
 * Each test works in a rolled-back transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

afterAll(async () => {
  await admin.end();
});

class Cancellation extends Error {}

type Ids = { school: string; season: string };

/** Runs `fn` on a fictitious school and season, then rolls everything back. */
async function withSeason(fn: (tx: postgres.TransactionSql, ids: Ids) => Promise<void>) {
  await admin
    .begin(async (tx) => {
      const [school] = await tx`INSERT INTO school (name, slug) VALUES ('École test', 'ecole-test') RETURNING id`;
      const [season] = await tx`
        INSERT INTO season (school_id, label, start_date, end_date)
        VALUES (${school.id}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
      await fn(tx, { school: school.id, season: season.id });
      throw new Cancellation();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Cancellation)) throw e;
    });
}

function insertTariff(
  tx: postgres.TransactionSql,
  ids: Ids,
  combination: number[],
  disciplineId: string | null = null,
) {
  return tx`
    INSERT INTO tariff (school_id, season_id, audience, period, combination, discipline_id, price_cents)
    VALUES (${ids.school}, ${ids.season}, 'child', 'quarter', ${combination}::smallint[], ${disciplineId}, 11000)`;
}

describe("tariff", () => {
  it("rejects two identical all-disciplines rows", async () => {
    await withSeason(async (tx, ids) => {
      await insertTariff(tx, ids, [45, 60]);
      await expect(tx.savepoint((sp) => insertTariff(sp, ids, [45, 60]))).rejects.toMatchObject({
        constraint_name: "tariff_cell_unique",
      });
    });
  });

  it("distinguishes two combinations with the same total duration", async () => {
    await withSeason(async (tx, ids) => {
      await insertTariff(tx, ids, [45, 45, 60]);
      await insertTariff(tx, ids, [60, 90]);
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM tariff WHERE season_id = ${ids.season}`;
      expect(n).toBe(2);
    });
  });

  it("accepts a discipline-specific row next to the general row", async () => {
    await withSeason(async (tx, ids) => {
      const [zumba] = await tx`INSERT INTO discipline (school_id, name) VALUES (${ids.school}, 'Zumba') RETURNING id`;
      await insertTariff(tx, ids, [60, 60]);
      await insertTariff(tx, ids, [60, 60], zumba.id);
    });
  });

  it("rejects a discipline from another school", async () => {
    await withSeason(async (tx, ids) => {
      const [other] = await tx`INSERT INTO school (name, slug) VALUES ('Autre école', 'autre-ecole') RETURNING id`;
      const [foreign] = await tx`INSERT INTO discipline (school_id, name) VALUES (${other.id}, 'Zumba') RETURNING id`;
      await expect(tx.savepoint((sp) => insertTariff(sp, ids, [60, 60], foreign.id))).rejects.toMatchObject({
        constraint_name: "tariff_discipline_same_school_fk",
      });
    });
  });

  it("rejects an empty combination or a zero duration", async () => {
    await withSeason(async (tx, ids) => {
      for (const combination of [[], [0, 60]]) {
        await expect(tx.savepoint((sp) => insertTariff(sp, ids, combination))).rejects.toMatchObject({
          constraint_name: "tariff_combination",
        });
      }
    });
  });
});
