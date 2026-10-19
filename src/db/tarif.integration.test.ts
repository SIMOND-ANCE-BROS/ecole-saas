import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Contraintes de la grille tarifaire : une case (saison × public × périodicité
 * × combinaison × discipline) n'existe qu'une fois, y compris pour les lignes
 * « toutes disciplines » (discipline NULL), et une combinaison n'est jamais vide.
 * Chaque test travaille dans une transaction annulée.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

afterAll(async () => {
  await admin.end();
});

class Annulation extends Error {}

type Ids = { ecole: string; saison: string };

/** Exécute `fn` sur une école et une saison fictives, puis annule tout. */
async function avecSaison(fn: (tx: postgres.TransactionSql, ids: Ids) => Promise<void>) {
  await admin
    .begin(async (tx) => {
      const [ecole] = await tx`INSERT INTO ecole (nom, slug) VALUES ('École test', 'ecole-test') RETURNING id`;
      const [saison] = await tx`
        INSERT INTO saison (ecole_id, libelle, date_debut, date_fin)
        VALUES (${ecole.id}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
      await fn(tx, { ecole: ecole.id, saison: saison.id });
      throw new Annulation();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Annulation)) throw e;
    });
}

function insererTarif(
  tx: postgres.TransactionSql,
  ids: Ids,
  combinaison: number[],
  disciplineId: string | null = null,
) {
  return tx`
    INSERT INTO tarif (ecole_id, saison_id, public, periodicite, combinaison, discipline_id, prix_centimes)
    VALUES (${ids.ecole}, ${ids.saison}, 'enfant', 'trimestre', ${combinaison}::smallint[], ${disciplineId}, 11000)`;
}

describe("tarif", () => {
  it("refuse deux lignes « toutes disciplines » identiques", async () => {
    await avecSaison(async (tx, ids) => {
      await insererTarif(tx, ids, [45, 60]);
      await expect(tx.savepoint((sp) => insererTarif(sp, ids, [45, 60]))).rejects.toMatchObject({
        constraint_name: "tarif_case_unique",
      });
    });
  });

  it("distingue deux combinaisons de même durée totale", async () => {
    await avecSaison(async (tx, ids) => {
      await insererTarif(tx, ids, [45, 45, 60]);
      await insererTarif(tx, ids, [60, 90]);
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM tarif WHERE saison_id = ${ids.saison}`;
      expect(n).toBe(2);
    });
  });

  it("accepte une ligne réservée à une discipline à côté de la ligne générale", async () => {
    await avecSaison(async (tx, ids) => {
      const [zumba] = await tx`INSERT INTO discipline (ecole_id, nom) VALUES (${ids.ecole}, 'Zumba') RETURNING id`;
      await insererTarif(tx, ids, [60, 60]);
      await insererTarif(tx, ids, [60, 60], zumba.id);
    });
  });

  it("refuse une discipline d’une autre école", async () => {
    await avecSaison(async (tx, ids) => {
      const [autre] = await tx`INSERT INTO ecole (nom, slug) VALUES ('Autre école', 'autre-ecole') RETURNING id`;
      const [etrangere] = await tx`INSERT INTO discipline (ecole_id, nom) VALUES (${autre.id}, 'Zumba') RETURNING id`;
      await expect(tx.savepoint((sp) => insererTarif(sp, ids, [60, 60], etrangere.id))).rejects.toMatchObject({
        constraint_name: "tarif_discipline_meme_ecole_fk",
      });
    });
  });

  it("refuse une combinaison vide ou une durée nulle", async () => {
    await avecSaison(async (tx, ids) => {
      for (const combinaison of [[], [0, 60]]) {
        await expect(tx.savepoint((sp) => insererTarif(sp, ids, combinaison))).rejects.toMatchObject({
          constraint_name: "tarif_combinaison",
        });
      }
    });
  });
});
