import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avecEcole } from "./index";
import { corrigerPaiement, encaisser, paiementsDe, soldeDe } from "./paiements";

/**
 * Encaissements (#97), comme l'application (app_user, RLS). Données fictives
 * supprimées à la fin ; paiements et journal étant inaltérables, le nettoyage
 * désactive leurs triggers le temps d'une transaction d'administration.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
const accueil = `pai-accueil-${suffixe}`;
const AUJOURDHUI = "2026-10-21";
let ecole: string;
let autreEcole: string;
let payeur: string;
let etranger: string;

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École A', ${`pa-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École B', ${`pb-${suffixe}`}) RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${accueil}, 'Accueil Test', ${`${accueil}@exemple.test`})`;
  await admin`INSERT INTO membre (ecole_id, user_id, role) VALUES (${ecole}, ${accueil}, 'accueil')`;
  [{ id: payeur }] = await admin`INSERT INTO personne (ecole_id, nom, prenom) VALUES (${ecole}, 'Martin', 'Sophie') RETURNING id`;
  [{ id: etranger }] = await admin`INSERT INTO personne (ecole_id, nom, prenom) VALUES (${autreEcole}, 'Ailleurs', 'Paul') RETURNING id`;
  const [s] = await admin`INSERT INTO saison (ecole_id, libelle, date_debut, date_fin) VALUES (${ecole}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  await admin`INSERT INTO inscription (ecole_id, saison_id, payeur_id, public, periodicite, prix_brut_centimes) VALUES (${ecole}, ${s.id}, ${payeur}, 'enfant', 'annee', 30000)`;
  await admin`INSERT INTO inscription (ecole_id, saison_id, payeur_id, public, periodicite, prix_brut_centimes, statut) VALUES (${ecole}, ${s.id}, ${payeur}, 'enfant', 'trimestre', 9000, 'abandon')`;
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE paiement DISABLE TRIGGER paiement_inalterable`;
    await t`ALTER TABLE journal DISABLE TRIGGER journal_ajout_seul`;
    await t`DELETE FROM journal WHERE ecole_id IN (${ecole}, ${autreEcole})`;
    await t`DELETE FROM paiement WHERE ecole_id IN (${ecole}, ${autreEcole}) AND corrige_id IS NOT NULL`;
    await t`DELETE FROM paiement WHERE ecole_id IN (${ecole}, ${autreEcole})`;
    await t`ALTER TABLE paiement ENABLE TRIGGER paiement_inalterable`;
    await t`ALTER TABLE journal ENABLE TRIGGER journal_ajout_seul`;
  });
  for (const t of ["inscription", "saison", "personne", "membre"]) await admin.unsafe(`DELETE FROM ${t} WHERE ecole_id IN ($1, $2)`, [ecole, autreEcole]);
  await admin`DELETE FROM "user" WHERE id = ${accueil}`;
  await admin`DELETE FROM ecole WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

const cheque = (montantCentimes: number, encaissementPrevu: string | null, reference: string) => ({
  moyen: "cheque" as const,
  montantCentimes,
  date: AUJOURDHUI,
  reference,
  emetteur: null,
  encaissementPrevu,
});

describe("encaisser", () => {
  let ids: string[] = [];

  it("trois chèques datés : solde à jour, chèques à encaisser, journal tenu", async () => {
    const r = await avecEcole(ecole, (tx) =>
      encaisser(tx, accueil, payeur, [cheque(10000, null, "0001"), cheque(10000, "2027-01-05", "0002"), cheque(10000, "2027-04-05", "0003")]),
    );
    if (!r.ok) throw new Error(r.message);
    ids = r.ids;
    expect(await avecEcole(ecole, (tx) => soldeDe(tx, payeur, AUJOURDHUI))).toEqual({
      du: 30000,
      paye: 30000,
      reste: 0,
      aEncaisser: 20000,
      horsCalcul: { abandon: 9000 },
    });
    const traces = await admin`SELECT action, apres->>'montant_centimes' AS montant, qui IS NOT NULL AS signe FROM journal WHERE ecole_id = ${ecole} AND table_cible = 'paiement'`;
    expect(traces).toHaveLength(3);
    expect(traces.every((t) => t.action === "insert" && t.montant === "10000" && t.signe)).toBe(true);
  });

  it("refuse des espèces « à encaisser plus tard », un payeur d'une autre école, un compte non membre", async () => {
    expect(await avecEcole(ecole, (tx) => encaisser(tx, accueil, payeur, [{ ...cheque(5000, "2027-01-05", ""), moyen: "especes" }]))).toEqual({
      ok: false,
      message: "Seul un chèque s’encaisse plus tard",
    });
    expect(await avecEcole(ecole, (tx) => encaisser(tx, accueil, etranger, [cheque(5000, null, "x")]))).toEqual({ ok: false, message: "Payeur introuvable." });
    expect(await avecEcole(ecole, (tx) => encaisser(tx, "inconnu", payeur, [cheque(5000, null, "x")]))).toEqual({ ok: false, message: "Accès refusé." });
  });

  it("un paiement ne se modifie ni ne se supprime (trigger) ; on corrige par un paiement négatif", async () => {
    await expect(admin`UPDATE paiement SET montant_centimes = 1 WHERE id = ${ids[0]}`).rejects.toThrow(/ne se modifie pas/);
    await expect(admin`DELETE FROM paiement WHERE id = ${ids[0]}`).rejects.toThrow(/ne se supprime pas/);
    expect((await avecEcole(ecole, (tx) => corrigerPaiement(tx, accueil, ids[0], 4000, AUJOURDHUI))).ok).toBe(true);
    expect(await avecEcole(ecole, (tx) => corrigerPaiement(tx, accueil, ids[0], 7000, AUJOURDHUI))).toEqual({
      ok: false,
      message: "La correction dépasse le montant encore non corrigé.",
    });
    const lignes = await avecEcole(ecole, (tx) => paiementsDe(tx, payeur));
    const correction = lignes.find((l) => l.corrigeId === ids[0]);
    expect(correction).toMatchObject({ montantCentimes: -4000, moyen: "cheque", saisiPar: "Accueil Test" });
    expect(lignes.find((l) => l.id === ids[0])?.corrigeCentimes).toBe(4000);
    expect(await avecEcole(ecole, (tx) => corrigerPaiement(tx, accueil, correction!.id, 100, AUJOURDHUI))).toEqual({
      ok: false,
      message: "Ce paiement ne peut pas être corrigé.",
    });
    expect((await avecEcole(ecole, (tx) => soldeDe(tx, payeur, AUJOURDHUI)))?.reste).toBe(4000);
  });

  it("une autre école ne voit ni les paiements ni le solde", async () => {
    expect(await avecEcole(autreEcole, (tx) => paiementsDe(tx, payeur))).toEqual([]);
    expect(await avecEcole(autreEcole, (tx) => soldeDe(tx, payeur, AUJOURDHUI))).toBeNull();
    expect(await avecEcole(autreEcole, (tx) => corrigerPaiement(tx, accueil, ids[1], 100, AUJOURDHUI))).toEqual({
      ok: false,
      message: "Ce paiement ne peut pas être corrigé.",
    });
  });
});
