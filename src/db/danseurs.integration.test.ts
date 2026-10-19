import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerDanseur, lireDanseur, modifierDanseur, type SaisieDanseur } from "./danseurs";
import { avecEcole } from "./index";

/** Fiche danseur, lue et écrite comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
let ecole: string;
let autreEcole: string;
let saison: string;
let ancienneSaison: string;
let famille: string;
let familleEtrangere: string;
let zoe: string;
let jazz: string;

const lea: SaisieDanseur = {
  prenom: "Léa",
  nom: "Lefèvre",
  dateNaissance: "2014-06-21",
  contactUrgence: "Hélène Lefèvre (mère)",
  telephoneUrgence: "06 12 34 56 78",
  notes: null,
};

async function cours(saisonId: string, nom: string, jour: number) {
  const [d] = await admin`INSERT INTO discipline (ecole_id, nom) VALUES (${ecole}, ${nom}) ON CONFLICT (ecole_id, nom) DO UPDATE SET nom = EXCLUDED.nom RETURNING id`;
  const [s] = await admin`INSERT INTO site (ecole_id, nom, adresse) VALUES (${ecole}, ${`Site ${nom}`}, '1 rue Test') RETURNING id`;
  const [salle] = await admin`INSERT INTO salle (ecole_id, site_id, nom) VALUES (${ecole}, ${s.id}, 'Studio') RETURNING id`;
  const [p] = await admin`INSERT INTO intervenant (ecole_id, nom, prenom, statut, regime_tva, mode_remuneration, tarif_centimes)
    VALUES (${ecole}, 'Roux', 'Mathis', 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`;
  const [c] = await admin`INSERT INTO cours (ecole_id, saison_id, discipline_id, salle_id, intervenant_id, jour_semaine, heure_debut, duree_minutes)
    VALUES (${ecole}, ${saisonId}, ${d.id}, ${salle.id}, ${p.id}, ${jour}, '17:00', 60) RETURNING id`;
  return c.id as string;
}

async function inscrire(saisonId: string, coursId: string, statut: string) {
  const [i] = await admin`INSERT INTO inscription (ecole_id, saison_id, payeur_id, public, periodicite, prix_brut_centimes, statut)
    VALUES (${ecole}, ${saisonId}, ${famille}, 'enfant', 'trimestre', 10000, ${statut}) RETURNING id`;
  await admin`INSERT INTO inscription_cours (ecole_id, inscription_id, danseur_id, cours_id) VALUES (${ecole}, ${i.id}, ${zoe}, ${coursId})`;
}

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École A', ${`da-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École B', ${`db-${suffixe}`}) RETURNING id`;
  [{ id: saison }] = await admin`INSERT INTO saison (ecole_id, libelle, date_debut, date_fin) VALUES (${ecole}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: ancienneSaison }] = await admin`INSERT INTO saison (ecole_id, libelle, date_debut, date_fin) VALUES (${ecole}, '2025-2026', '2025-09-01', '2026-06-30') RETURNING id`;
  [{ id: famille }] = await admin`INSERT INTO payeur (ecole_id, nom, prenom, telephone, email) VALUES (${ecole}, 'Lefèvre', 'Hélène', '06 12 34 56 78', 'h@exemple.test') RETURNING id`;
  [{ id: familleEtrangere }] = await admin`INSERT INTO payeur (ecole_id, nom) VALUES (${autreEcole}, 'Ailleurs') RETURNING id`;
  [{ id: zoe }] = await admin`INSERT INTO danseur (ecole_id, payeur_id, nom, prenom, date_naissance, notes)
    VALUES (${ecole}, ${famille}, 'Lefèvre', 'Zoé', '2015-03-10', 'Asthme : ventoline dans le sac') RETURNING id`;
  jazz = await cours(saison, "Jazz", 3);
  await inscrire(saison, jazz, "active");
  await inscrire(ancienneSaison, await cours(ancienneSaison, "Classique", 2), "terminee");
  await admin`INSERT INTO document_danseur (ecole_id, danseur_id, type, accorde, valide_jusqu) VALUES (${ecole}, ${zoe}, 'certificat_medical', true, '2027-09-30')`;
});

afterAll(async () => {
  for (const t of ["document_danseur", "inscription_cours", "inscription", "cours", "salle", "site", "discipline", "intervenant", "danseur", "payeur", "saison"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE ecole_id IN ($1, $2)`, [ecole, autreEcole]);
  }
  await admin`DELETE FROM ecole WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

describe("lireDanseur", () => {
  it("donne l’identité, la famille, les cours de chaque saison et les documents", async () => {
    const d = await avecEcole(ecole, (tx) => lireDanseur(tx, zoe));
    expect(d).toMatchObject({
      id: zoe,
      prenom: "Zoé",
      nom: "Lefèvre",
      dateNaissance: "2015-03-10",
      notes: "Asthme : ventoline dans le sac",
      famille: { id: famille, nom: "Lefèvre", telephone: "06 12 34 56 78", email: "h@exemple.test" },
      documents: [{ type: "certificat_medical", accorde: true, valideJusqu: "2027-09-30" }],
    });
    expect(d?.cours.map((c) => `${c.saison} ${c.discipline} ${c.statut}`)).toEqual(["2026-2027 Jazz active", "2025-2026 Classique terminee"]);
    expect(d?.cours[0]).toMatchObject({ id: jazz, jourSemaine: 3, heureDebut: "17:00" });
  });

  it("ne lit pas un danseur d’une autre école, ni un identifiant invalide", async () => {
    const [{ id }] = await admin`INSERT INTO danseur (ecole_id, payeur_id, nom, prenom) VALUES (${autreEcole}, ${familleEtrangere}, 'Ailleurs', 'Inconnu') RETURNING id`;
    expect(await avecEcole(ecole, (tx) => lireDanseur(tx, id))).toBeNull();
    expect(await avecEcole(ecole, (tx) => lireDanseur(tx, "pas-un-uuid"))).toBeNull();
  });
});

describe("creerDanseur et modifierDanseur", () => {
  it("ajoute un danseur à la famille puis le modifie", async () => {
    const r = await avecEcole(ecole, (tx) => creerDanseur(tx, famille, lea));
    expect(r.ok).toBe(true);
    const id = r.ok ? r.id : "";
    expect(await avecEcole(ecole, (tx) => lireDanseur(tx, id))).toMatchObject({ ...lea, cours: [], documents: [] });
    expect(await avecEcole(ecole, (tx) => modifierDanseur(tx, id, { ...lea, notes: "Allergie aux arachides" }))).toEqual({ ok: true, id });
    expect((await avecEcole(ecole, (tx) => lireDanseur(tx, id)))?.notes).toBe("Allergie aux arachides");
  });

  it("refuse une famille d’une autre école et un danseur inconnu", async () => {
    expect(await avecEcole(ecole, (tx) => creerDanseur(tx, familleEtrangere, lea))).toEqual({ ok: false, message: "Famille introuvable." });
    expect(await avecEcole(ecole, (tx) => modifierDanseur(tx, "00000000-0000-4000-8000-000000000000", lea))).toEqual({
      ok: false,
      message: "Ce danseur n’existe plus.",
    });
  });
});
