import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerJetonAgenda, etatAgenda, lireAgenda, revoquerJetonAgenda } from "./agenda";
import { lireIntervenant, modifierIntervenant } from "./intervenants";
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
  [{ id: ecole }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ga-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`gb-${suffixe}`}) RETURNING id`;
  const [saison] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${ecole}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${ecole}, 'Jazz') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${ecole}, 'Centre', '1 rue Test') RETURNING id`;
  const [salle] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${ecole}, ${s.id}, 'Studio') RETURNING id`;
  const prof = async (prenom: string) =>
    (
      await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
        VALUES (${ecole}, 'Prof', ${prenom}, 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`
    )[0].id as string;
  camille = await prof("Camille");
  ines = await prof("Inès");
  const [c] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes, level)
    VALUES (${ecole}, ${saison.id}, ${d.id}, ${salle.id}, ${camille}, 3, '17:00', 60, 'Débutant') RETURNING id`;
  await admin`INSERT INTO lesson (school_id, course_id, date, instructor_id, status) VALUES
    (${ecole}, ${c.id}, '2026-10-14', ${camille}, 'effectuee'),
    (${ecole}, ${c.id}, '2026-11-04', ${camille}, 'prevue'),
    (${ecole}, ${c.id}, '2026-11-18', ${ines}, 'prevue'),
    (${ecole}, ${c.id}, '2026-11-25', ${camille}, 'annulee')`;
});

afterAll(async () => {
  for (const t of ["lesson", "course", "instructor", "room", "site", "discipline", "season"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [ecole, autreEcole]);
  }
  await admin`DELETE FROM school WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

describe("abonnement iCal", () => {
  it("crée un jeton dont seule l’empreinte est gardée, et donne les séances à venir sans le remplacement", async () => {
    const jeton = await avecEcole(ecole, (tx) => creerJetonAgenda(tx, camille));
    expect(jeton).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [{ calendar_token_hash: jeton_agenda_hash }] =
      await admin`SELECT calendar_token_hash FROM instructor WHERE id = ${camille}`;
    expect(jeton_agenda_hash).not.toBe(jeton);
    expect(jeton_agenda_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await avecEcole(ecole, (tx) => etatAgenda(tx, camille))).toBeInstanceOf(Date);

    const agenda = await avecEcole(ecole, (tx) => lireAgenda(tx, jeton as string, "2026-10-20"));
    expect(agenda?.nom).toBe("Cours de Camille, École A");
    expect(agenda?.seances.map((s) => `${s.date} ${s.titre} ${s.annulee}`)).toEqual([
      "2026-11-04 Jazz Débutant false",
      "2026-11-25 Jazz Débutant true",
    ]);
    expect(agenda?.seances[0]).toMatchObject({
      heureDebut: "17:00",
      dureeMinutes: 60,
      lieu: "Studio, Centre, 1 rue Test",
    });
  });

  it("donne au remplaçant la séance qu’il assure", async () => {
    const jeton = await avecEcole(ecole, (tx) => creerJetonAgenda(tx, ines));
    expect(
      (await avecEcole(ecole, (tx) => lireAgenda(tx, jeton as string, "2026-10-20")))?.seances.map((s) => s.date),
    ).toEqual(["2026-11-18"]);
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

  it("coupe le lien d’un intervenant désactivé, même remis en base à la main", async () => {
    const jeton = (await avecEcole(ecole, (tx) => creerJetonAgenda(tx, ines))) as string;
    const fiche = await avecEcole(ecole, (tx) => lireIntervenant(tx, ines));
    if (!fiche) throw new Error("intervenant introuvable");
    const { id, ...saisie } = fiche;
    expect(id).toBe(ines);
    await avecEcole(ecole, (tx) => modifierIntervenant(tx, ines, { ...saisie, actif: false }));
    expect(await avecEcole(ecole, (tx) => etatAgenda(tx, ines))).toBeNull();

    // Même si l'empreinte revenait (restauration de sauvegarde), un inactif ne lit rien.
    const [{ empreinte }] = await admin`SELECT encode(sha256(${jeton}::bytea), 'hex') AS empreinte`;
    await admin`UPDATE instructor SET calendar_token_hash = ${empreinte} WHERE id = ${ines}`;
    expect(await avecEcole(ecole, (tx) => lireAgenda(tx, jeton, "2026-10-20"))).toBeNull();
  });
});
