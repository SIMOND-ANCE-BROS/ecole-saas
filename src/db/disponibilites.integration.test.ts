import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ajouterIndisponibilite,
  conflitsCreneau,
  disponibilitesSeance,
  listerIndisponibilites,
  remplacerIndisponibilitesAgenda,
  seancesEnConflit,
  supprimerIndisponibilite,
} from "./disponibilites";
import { avecEcole } from "./index";

/** Indisponibilités, conflits et remplaçants, comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
let ecole: string;
let autreEcole: string;
let saison: string;
let jazz: string;
let camille: string;
let ines: string;
let lucas: string;
let etranger: string;
const seances: Record<string, string> = {};
const AUJOURDHUI = "2026-10-19";

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`da-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`db-${suffixe}`}) RETURNING id`;
  [{ id: saison }] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${ecole}, '2026-2027', '2026-09-01', '2026-11-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${ecole}, 'Jazz') RETURNING id`;
  const [z] = await admin`INSERT INTO discipline (school_id, name) VALUES (${ecole}, 'Zumba') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${ecole}, 'Centre', '1 rue Test') RETURNING id`;
  const [salle] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${ecole}, ${s.id}, 'Studio') RETURNING id`;
  const prof = async (ecoleId: string, prenom: string) =>
    (
      await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
        VALUES (${ecoleId}, 'Prof', ${prenom}, 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`
    )[0].id as string;
  camille = await prof(ecole, "Camille");
  ines = await prof(ecole, "Inès");
  lucas = await prof(ecole, "Lucas");
  etranger = await prof(autreEcole, "Ailleurs");
  // Jazz le mercredi 17:00 (Camille) ; Zumba le mercredi 17:30 (Lucas, qui enseigne aussi le jazz ailleurs dans la saison).
  [{ id: jazz }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${ecole}, ${saison}, ${d.id}, ${salle.id}, ${camille}, 3, '17:00', 60) RETURNING id`;
  const [zumba] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${ecole}, ${saison}, ${z.id}, ${salle.id}, ${lucas}, 3, '17:30', 60) RETURNING id`;
  await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${ecole}, ${saison}, ${d.id}, ${salle.id}, ${lucas}, 5, '18:00', 60)`;
  for (const date of ["2026-11-04", "2026-11-18"]) {
    [{ id: seances[date] }] =
      await admin`INSERT INTO lesson (school_id, course_id, date, instructor_id) VALUES (${ecole}, ${jazz}, ${date}, ${camille}) RETURNING id`;
    await admin`INSERT INTO lesson (school_id, course_id, date, instructor_id) VALUES (${ecole}, ${zumba.id}, ${date}, ${lucas})`;
  }
});

afterAll(async () => {
  for (const t of ["unavailability", "lesson", "course", "instructor", "room", "site", "discipline", "season"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [ecole, autreEcole]);
  }
  await admin`DELETE FROM school WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

const instant = (iso: string) => new Date(iso); // instants écrits avec leur décalage

describe("indisponibilités saisies", () => {
  it("ajoute et liste une indisponibilité ; refuse une fin avant le début", async () => {
    expect(
      await avecEcole(ecole, (tx) =>
        ajouterIndisponibilite(tx, camille, {
          debut: instant("2026-11-10T10:00:00+01:00"),
          fin: instant("2026-11-10T09:00:00+01:00"),
          libelle: null,
        }),
      ),
    ).toEqual({ ok: false, message: "La fin doit suivre le début." });
    const r = await avecEcole(ecole, (tx) =>
      ajouterIndisponibilite(tx, camille, {
        debut: instant("2026-11-04T16:30:00+01:00"),
        fin: instant("2026-11-04T19:00:00+01:00"),
        libelle: " Stage ",
      }),
    );
    expect(r.ok).toBe(true);
    const liste = await avecEcole(ecole, (tx) =>
      listerIndisponibilites(tx, camille, instant("2026-10-19T00:00:00+02:00")),
    );
    expect(liste).toMatchObject([{ origine: "saisie", libelle: "Stage" }]);
  });

  it("refuse un intervenant d’une autre école", async () => {
    expect(
      await avecEcole(ecole, (tx) =>
        ajouterIndisponibilite(tx, etranger, {
          debut: instant("2026-11-04T10:00:00+01:00"),
          fin: instant("2026-11-04T11:00:00+01:00"),
          libelle: null,
        }),
      ),
    ).toEqual({ ok: false, message: "Intervenant introuvable." });
  });
});

describe("conflits", () => {
  it("signale les dates à venir d’un créneau hebdomadaire pendant une indisponibilité", async () => {
    const dates = await avecEcole(ecole, (tx) =>
      conflitsCreneau(
        tx,
        { saisonId: saison, intervenantId: camille, jourSemaine: 3, heureDebut: "17:00", dureeMinutes: 60 },
        AUJOURDHUI,
      ),
    );
    expect(dates).toEqual(["2026-11-04"]);
    expect(
      await avecEcole(ecole, (tx) =>
        conflitsCreneau(
          tx,
          { saisonId: saison, intervenantId: camille, jourSemaine: 3, heureDebut: "19:00", dureeMinutes: 60 },
          AUJOURDHUI,
        ),
      ),
    ).toEqual([]);
  });

  it("signale les séances prévues du cours touchées", async () => {
    expect([...(await avecEcole(ecole, (tx) => seancesEnConflit(tx, jazz, AUJOURDHUI)))]).toEqual([
      seances["2026-11-04"],
    ]);
  });
});

describe("remplaçants", () => {
  it("dit que le titulaire est indisponible et classe les remplaçants", async () => {
    const d = await avecEcole(ecole, (tx) => disponibilitesSeance(tx, seances["2026-11-04"]));
    expect(d?.indisponible).toBe(true);
    // Inès est libre ; Lucas enseigne le jazz mais donne la Zumba à 17:30.
    expect(d?.remplacants.map((r) => `${r.nom} ${r.libre} ${r.motif} ${r.enseigne}`)).toEqual([
      "Inès Prof true null false",
      "Lucas Prof false autre séance true",
    ]);
    expect((await avecEcole(ecole, (tx) => disponibilitesSeance(tx, seances["2026-11-18"])))?.indisponible).toBe(false);
  });

  it("ne lit pas une séance d’une autre école", async () => {
    expect(await avecEcole(autreEcole, (tx) => disponibilitesSeance(tx, seances["2026-11-04"]))).toBeNull();
  });
});

describe("synchronisation d’un agenda", () => {
  it("remplace les plages lues sur la fenêtre, sans toucher aux indisponibilités saisies", async () => {
    const fenetre = { debut: instant("2026-11-01T00:00:00+01:00"), fin: instant("2026-12-01T00:00:00+01:00") };
    await avecEcole(ecole, (tx) =>
      remplacerIndisponibilitesAgenda(tx, ines, "google", fenetre, [
        { debut: instant("2026-11-18T16:00:00+01:00"), fin: instant("2026-11-18T18:00:00+01:00") },
        { debut: instant("2026-11-20T10:00:00+01:00"), fin: instant("2026-11-20T09:00:00+01:00") }, // invalide, ignorée
      ]),
    );
    await avecEcole(ecole, (tx) =>
      remplacerIndisponibilitesAgenda(tx, ines, "google", fenetre, [
        { debut: instant("2026-11-25T16:00:00+01:00"), fin: instant("2026-11-25T18:00:00+01:00") },
      ]),
    );
    const liste = await avecEcole(ecole, (tx) =>
      listerIndisponibilites(tx, ines, instant("2026-10-19T00:00:00+02:00")),
    );
    expect(liste.map((i) => `${i.origine} ${i.debut.toISOString()}`)).toEqual(["google 2026-11-25T15:00:00.000Z"]);

    expect(await avecEcole(ecole, (tx) => supprimerIndisponibilite(tx, liste[0].id))).toEqual({
      ok: false,
      message: "Cette indisponibilité n’existe plus ou vient d’un agenda.",
    });
    // L'indisponibilité saisie de Camille est toujours là.
    expect(
      await avecEcole(ecole, (tx) => listerIndisponibilites(tx, camille, instant("2026-10-19T00:00:00+02:00"))),
    ).toHaveLength(1);
  });
});
