import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avecEcole } from "./index";
import { corrigerPaiement, encaisser } from "./paiements";
import {
  annulerRemise,
  creerRemise,
  journalEncaissements,
  lireRemise,
  listerRemises,
  paiementsARemettre,
} from "./remises";

/**
 * Remises en banque et journal des encaissements (#98), comme l'application
 * (app_user, RLS). Données fictives supprimées à la fin ; paiements et
 * journal étant inaltérables, le nettoyage désactive leurs triggers le temps
 * d'une transaction d'administration.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
const direction = `rem-direction-${suffixe}`;
const AUJOURDHUI = "2026-10-21";
let ecole: string;
let autreEcole: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ra-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`rb-${suffixe}`}) RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${direction}, 'Direction Test', ${`${direction}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${ecole}, ${direction}, 'direction'), (${autreEcole}, ${direction}, 'direction')`;
  const [p] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${ecole}, 'Martin', 'Sophie') RETURNING id`;
  const r = await avecEcole(ecole, (tx) =>
    encaisser(tx, direction, p.id, [
      {
        moyen: "cheque",
        montantCentimes: 10000,
        date: AUJOURDHUI,
        reference: "0001",
        emetteur: "Banque A",
        encaissementPrevu: null,
      },
      {
        moyen: "cheque",
        montantCentimes: 10000,
        date: AUJOURDHUI,
        reference: "0002",
        emetteur: "Banque A",
        encaissementPrevu: "2027-01-05",
      },
      {
        moyen: "especes",
        montantCentimes: 2000,
        date: AUJOURDHUI,
        reference: null,
        emetteur: null,
        encaissementPrevu: null,
      },
      {
        moyen: "carte",
        montantCentimes: 8000,
        date: AUJOURDHUI,
        reference: null,
        emetteur: null,
        encaissementPrevu: null,
      },
      {
        moyen: "cheque",
        montantCentimes: 5000,
        date: AUJOURDHUI,
        reference: "0003",
        emetteur: null,
        encaissementPrevu: null,
      },
    ]),
  );
  if (!r.ok) throw new Error(r.message);
  [ids.cheque, ids.differe, ids.especes, ids.carte, ids.annule] = r.ids;
  await avecEcole(ecole, (tx) => corrigerPaiement(tx, direction, ids.annule, 5000, AUJOURDHUI));
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`DELETE FROM bank_deposit WHERE school_id IN (${ecole}, ${autreEcole})`;
    await t`ALTER TABLE payment DISABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${ecole}, ${autreEcole})`;
    await t`DELETE FROM payment WHERE school_id IN (${ecole}, ${autreEcole}) AND corrects_id IS NOT NULL`;
    await t`DELETE FROM payment WHERE school_id IN (${ecole}, ${autreEcole})`;
    await t`ALTER TABLE payment ENABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of ["person", "member"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [ecole, autreEcole]);
  await admin`DELETE FROM "user" WHERE id = ${direction}`;
  await admin`DELETE FROM school WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

const aRemettre = () => avecEcole(ecole, (tx) => paiementsARemettre(tx, AUJOURDHUI));

describe("remises en banque", () => {
  let remiseCheques: string;

  it("à remettre : chèque arrivé à échéance et espèces ; ni carte, ni chèque différé, ni chèque entièrement corrigé", async () => {
    const r = await aRemettre();
    expect(r.cheque.map((p) => p.id)).toEqual([ids.cheque]);
    expect(r.especes.map((p) => p.id)).toEqual([ids.especes]);
    expect(r.cheque_vacances).toEqual([]);
  });

  it("crée une remise de chèques ; refuse un chèque déjà remis, un autre moyen, un chèque pas encore à encaisser", async () => {
    const r = await avecEcole(ecole, (tx) =>
      creerRemise(tx, direction, { date: AUJOURDHUI, moyen: "cheque", paiementIds: [ids.cheque] }, AUJOURDHUI),
    );
    if (!r.ok) throw new Error(r.message);
    remiseCheques = r.id;
    const refus = {
      ok: false,
      message:
        "Un des paiements choisis n’est plus à remettre (déjà remis, corrigé, pas encore à encaisser ou d’un autre moyen).",
    };
    expect(
      await avecEcole(ecole, (tx) =>
        creerRemise(tx, direction, { date: AUJOURDHUI, moyen: "cheque", paiementIds: [ids.cheque] }, AUJOURDHUI),
      ),
    ).toEqual(refus);
    expect(
      await avecEcole(ecole, (tx) =>
        creerRemise(tx, direction, { date: AUJOURDHUI, moyen: "cheque", paiementIds: [ids.especes] }, AUJOURDHUI),
      ),
    ).toEqual(refus);
    expect(
      await avecEcole(ecole, (tx) =>
        creerRemise(tx, direction, { date: AUJOURDHUI, moyen: "cheque", paiementIds: [ids.differe] }, AUJOURDHUI),
      ),
    ).toEqual(refus);
    // Une remise datée du jour d'encaissement prévu accepte le chèque différé.
    expect(
      (
        await avecEcole(ecole, (tx) =>
          creerRemise(tx, direction, { date: "2027-01-05", moyen: "cheque", paiementIds: [ids.differe] }, AUJOURDHUI),
        )
      ).ok,
    ).toBe(true);
    expect((await aRemettre()).cheque).toEqual([]);
  });

  it("un paiement ne peut figurer que dans une seule remise (contrainte en base)", async () => {
    const [{ id: autre }] =
      await admin`INSERT INTO bank_deposit (school_id, date, method) VALUES (${ecole}, ${AUJOURDHUI}, 'cheque') RETURNING id`;
    await expect(
      admin`INSERT INTO bank_deposit_payment (school_id, bank_deposit_id, payment_id) VALUES (${ecole}, ${autre}, ${ids.cheque})`,
    ).rejects.toThrow();
    await admin`DELETE FROM bank_deposit WHERE id = ${autre}`;
  });

  it("bordereau, liste et journal des encaissements", async () => {
    const b = await avecEcole(ecole, (tx) => lireRemise(tx, remiseCheques));
    expect(b).toMatchObject({
      moyen: "cheque",
      nombre: 1,
      totalCentimes: 10000,
      paiements: [{ reference: "0001", emetteur: "Banque A", payeur: "Sophie Martin" }],
    });
    expect(
      (await avecEcole(ecole, (tx) => listerRemises(tx))).map(
        (x) => `${x.date} ${x.moyen} ${x.nombre} ${x.totalCentimes}`,
      ),
    ).toEqual(["2027-01-05 cheque 1 10000", "2026-10-21 cheque 1 10000"]);
    const j = await avecEcole(ecole, (tx) => journalEncaissements(tx, AUJOURDHUI, AUJOURDHUI, null));
    expect(j).toHaveLength(6); // cinq règlements et une correction
    expect(j.find((x) => x.id === ids.cheque)?.remiseDate).toBe(AUJOURDHUI);
    expect(await avecEcole(ecole, (tx) => journalEncaissements(tx, AUJOURDHUI, AUJOURDHUI, "especes"))).toHaveLength(1);
  });

  it("annuler une remise rend ses chèques à remettre et laisse une trace", async () => {
    expect((await avecEcole(ecole, (tx) => annulerRemise(tx, direction, remiseCheques))).ok).toBe(true);
    expect((await aRemettre()).cheque.map((p) => p.id)).toEqual([ids.cheque]);
    const [t] = await admin`SELECT action FROM audit_log WHERE row_id = ${remiseCheques} AND action = 'delete'`;
    expect(t?.action).toBe("delete");
  });

  it("une autre école ne voit rien et ne peut pas remettre ces paiements", async () => {
    expect(await avecEcole(autreEcole, (tx) => listerRemises(tx))).toEqual([]);
    expect((await avecEcole(autreEcole, (tx) => paiementsARemettre(tx, AUJOURDHUI))).cheque).toEqual([]);
    expect(
      (
        await avecEcole(autreEcole, (tx) =>
          creerRemise(tx, direction, { date: AUJOURDHUI, moyen: "cheque", paiementIds: [ids.cheque] }, AUJOURDHUI),
        )
      ).ok,
    ).toBe(false);
  });
});
