import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerJetonAgenda, etatAgenda, lireAgenda, revoquerJetonAgenda } from "./agenda";
import { avecEcole } from "./index";

/** Abonnement iCal d'un intervenant, comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
let ecole: string;
let autreEcole: string;
let camille: string;
let ines: string;

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École A', ${`ga-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École B', ${`gb-${suffixe}`}) RETURNING id`;
  const [saison] = await admin`INSERT INTO saison (ecole_id, libelle, date_debut, date_fin) VALUES (${ecole}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (ecole_id, nom) VALUES (${ecole}, 'Jazz') RETURNING id`;
  const [s] = await admin`INSERT INTO site (ecole_id, nom, adresse) VALUES (${ecole}, 'Centre', '1 rue Test') RETURNING id`;
  const [salle] = await admin`INSERT INTO salle (ecole_id, site_id, nom) VALUES (${ecole}, ${s.id}, 'Studio') RETURNING id`;
  const prof = async (prenom: string) =>
    (
      await admin`INSERT INTO intervenant (ecole_id, nom, prenom, statut, regime_tva, mode_remuneration, tarif_centimes)
        VALUES (${ecole}, 'Prof', ${prenom}, 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`
    )[0].id as string;
  camille = await prof("Camille");
  ines = await prof("Inès");
  const [c] = await admin`INSERT INTO cours (ecole_id, saison_id, discipline_id, salle_id, intervenant_id, jour_semaine, heure_debut, duree_minutes, niveau)
    VALUES (${ecole}, ${saison.id}, ${d.id}, ${salle.id}, ${camille}, 3, '17:00', 60, 'Débutant') RETURNING id`;
  await admin`INSERT INTO seance (ecole_id, cours_id, date, intervenant_id, statut) VALUES
    (${ecole}, ${c.id}, '2026-10-14', ${camille}, 'effectuee'),
    (${ecole}, ${c.id}, '2026-11-04', ${camille}, 'prevue'),
    (${ecole}, ${c.id}, '2026-11-18', ${ines}, 'prevue'),
    (${ecole}, ${c.id}, '2026-11-25', ${camille}, 'annulee')`;
});

afterAll(async () => {
  for (const t of ["seance", "cours", "intervenant", "salle", "site", "discipline", "saison"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE ecole_id IN ($1, $2)`, [ecole, autreEcole]);
  }
  await admin`DELETE FROM ecole WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

describe("abonnement iCal", () => {
  it("crée un jeton dont seule l’empreinte est gardée, et donne les séances à venir sans le remplacement", async () => {
    const jeton = await avecEcole(ecole, (tx) => creerJetonAgenda(tx, camille));
    expect(jeton).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [{ jeton_agenda_hash }] = await admin`SELECT jeton_agenda_hash FROM intervenant WHERE id = ${camille}`;
    expect(jeton_agenda_hash).not.toBe(jeton);
    expect(jeton_agenda_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await avecEcole(ecole, (tx) => etatAgenda(tx, camille))).toBeInstanceOf(Date);

    const agenda = await avecEcole(ecole, (tx) => lireAgenda(tx, jeton as string, "2026-10-20"));
    expect(agenda?.nom).toBe("Cours de Camille, École A");
    expect(agenda?.seances.map((s) => `${s.date} ${s.titre} ${s.annulee}`)).toEqual([
      "2026-11-04 Jazz Débutant false",
      "2026-11-25 Jazz Débutant true",
    ]);
    expect(agenda?.seances[0]).toMatchObject({ heureDebut: "17:00", dureeMinutes: 60, lieu: "Studio, Centre, 1 rue Test" });
  });

  it("donne au remplaçant la séance qu’il assure", async () => {
    const jeton = await avecEcole(ecole, (tx) => creerJetonAgenda(tx, ines));
    expect((await avecEcole(ecole, (tx) => lireAgenda(tx, jeton as string, "2026-10-20")))?.seances.map((s) => s.date)).toEqual(["2026-11-18"]);
  });

  it("refuse un jeton d’une autre école, un jeton inconnu, et un jeton remplacé ou révoqué", async () => {
    const ancien = (await avecEcole(ecole, (tx) => creerJetonAgenda(tx, camille))) as string;
    expect(await avecEcole(autreEcole, (tx) => lireAgenda(tx, ancien, "2026-10-20"))).toBeNull();
    expect(await avecEcole(ecole, (tx) => lireAgenda(tx, "x".repeat(43), "2026-10-20"))).toBeNull();
    expect(await avecEcole(ecole, (tx) => lireAgenda(tx, "court", "2026-10-20"))).toBeNull();

    const nouveau = (await avecEcole(ecole, (tx) => creerJetonAgenda(tx, camille))) as string;
    expect(await avecEcole(ecole, (tx) => lireAgenda(tx, ancien, "2026-10-20"))).toBeNull();
    expect(await avecEcole(ecole, (tx) => revoquerJetonAgenda(tx, camille))).toBe(true);
    expect(await avecEcole(ecole, (tx) => lireAgenda(tx, nouveau, "2026-10-20"))).toBeNull();
    expect(await avecEcole(ecole, (tx) => etatAgenda(tx, camille))).toBeNull();
  });
});
