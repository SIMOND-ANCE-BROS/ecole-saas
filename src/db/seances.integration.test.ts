import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { datesDuCours } from "../domaine/planning/seances";
import { ajouterJours } from "../domaine/planning/semaine";
import { creerCours, lireCours, modifierCours, supprimerCours } from "./cours";
import { avecEcole } from "./index";
import {
  ajouterFermeture,
  annulerSeance,
  deplacerSeance,
  changerIntervenant,
  enregistrerAppel,
  lireAppel,
  listerFermetures,
  seancesDeLaSemaine,
  seancesDuCours,
  seancesDuJour,
  supprimerFermeture,
  synchroniserSeances,
} from "./seances";

/** Séances, fermetures et appel, comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
let ecole: string;
let autreEcole: string;
let saison: string;
let mercredi: string; // cours du mercredi 17:00
let camille: string;
let ines: string;
let inactif: string;
const danseurs: Record<string, string> = {};

const AUJOURDHUI = "2026-10-19"; // un lundi

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`sa-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`sb-${suffixe}`}) RETURNING id`;
  [{ id: saison }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${ecole}, '2026-2027', '2026-09-01', '2026-11-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${ecole}, 'Jazz') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${ecole}, 'Centre', '1 rue Test') RETURNING id`;
  const [salle] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${ecole}, ${s.id}, 'Studio') RETURNING id`;
  const prof = async (prenom: string, actif = true) =>
    (
      await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents, active)
        VALUES (${ecole}, 'Prof', ${prenom}, 'salarie', 'non_applicable', 'heure', 3000, ${actif}) RETURNING id`
    )[0].id as string;
  camille = await prof("Camille");
  ines = await prof("Inès");
  inactif = await prof("Ancien", false);
  [{ id: mercredi }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${ecole}, ${saison}, ${d.id}, ${salle.id}, ${camille}, 3, '17:00', 60) RETURNING id`;

  const [payeur] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${ecole}, 'Martin', 'Paul') RETURNING id`;
  for (const [prenom, statut] of [
    ["Léa", "active"],
    ["Zoé", "essai"],
    ["Jules", "liste_attente"],
    ["Max", "abandon"],
  ]) {
    [{ id: danseurs[prenom] }] =
      await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${ecole}, 'Martin', ${prenom}) RETURNING id`;
    const [i] =
      await admin`INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents, status)
      VALUES (${ecole}, ${saison}, ${payeur.id}, 'enfant', 'trimestre', 10000, ${statut}) RETURNING id`;
    await admin`INSERT INTO enrollment_course (school_id, enrollment_id, student_id, course_id) VALUES (${ecole}, ${i.id}, ${danseurs[prenom]}, ${mercredi})`;
  }
});

afterAll(async () => {
  for (const t of [
    "attendance",
    "lesson",
    "course_date",
    "closure",
    "enrollment_course",
    "enrollment",
    "relationship",
    "person",
    "course",
    "instructor",
    "room",
    "site",
    "discipline",
    "season",
  ]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [ecole, autreEcole]);
  }
  await admin`DELETE FROM school WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

const seances = () => avecEcole(ecole, (tx) => seancesDuCours(tx, mercredi));
const dates = async () => (await seances()).map((s) => s.date);
const synchroniser = () => avecEcole(ecole, (tx) => synchroniserSeances(tx, saison, AUJOURDHUI));

describe("fermetures et génération des séances", () => {
  it("génère les mercredis à venir de la saison, sans le passé, puis ne duplique rien", async () => {
    expect(await synchroniser()).toEqual({ ajoutees: 6, retirees: 0 });
    expect(await dates()).toEqual(["2026-10-21", "2026-10-28", "2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"]);
    expect(await synchroniser()).toEqual({ ajoutees: 0, retirees: 0 });
  });

  it("refuse une fermeture dont la fin précède le début", async () => {
    expect(
      await avecEcole(ecole, (tx) =>
        ajouterFermeture(tx, saison, { libelle: "Erreur", debut: "2026-11-02", fin: "2026-11-01" }),
      ),
    ).toEqual({
      ok: false,
      message: "La fin précède le début.",
    });
  });

  it("retire les séances d’une fermeture, puis les remet quand elle est supprimée", async () => {
    const r = await avecEcole(ecole, (tx) =>
      ajouterFermeture(tx, saison, { libelle: "Toussaint", debut: "2026-10-17", fin: "2026-11-01" }),
    );
    expect(r.ok).toBe(true);
    expect(await synchroniser()).toEqual({ ajoutees: 0, retirees: 2 });
    expect(await dates()).toEqual(["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"]);
    expect((await avecEcole(ecole, (tx) => listerFermetures(tx, saison))).map((f) => f.libelle)).toEqual(["Toussaint"]);

    await avecEcole(ecole, (tx) => supprimerFermeture(tx, r.ok ? r.id : ""));
    expect(await synchroniser()).toEqual({ ajoutees: 2, retirees: 0 });
  });
});

describe("appel", () => {
  it("liste les danseurs inscrits et à l’essai, sans liste d’attente ni abandon", async () => {
    const [s] = await seances();
    const appel = await avecEcole(ecole, (tx) => lireAppel(tx, s.id));
    expect(appel).toMatchObject({
      date: "2026-10-21",
      statut: "prevue",
      discipline: "Jazz",
      heureDebut: "17:00",
      intervenantId: camille,
    });
    expect(appel?.danseurs.map((d) => `${d.prenom} ${d.statut} ${d.present}`)).toEqual([
      "Léa active null",
      "Zoé essai null",
    ]);
  });

  it("enregistre l’appel, le corrige, et marque la séance effectuée", async () => {
    const [s] = await seances();
    const lea = danseurs["Léa"];
    const zoe = danseurs["Zoé"];
    expect(
      await avecEcole(ecole, (tx) =>
        enregistrerAppel(tx, s.id, [
          { danseurId: lea, present: true },
          { danseurId: zoe, present: false },
        ]),
      ),
    ).toEqual({ ok: true, id: s.id });
    await avecEcole(ecole, (tx) =>
      enregistrerAppel(tx, s.id, [
        { danseurId: lea, present: true },
        { danseurId: zoe, present: true },
      ]),
    );
    const appel = await avecEcole(ecole, (tx) => lireAppel(tx, s.id));
    expect(appel?.statut).toBe("effectuee");
    expect(appel?.danseurs.map((d) => d.present)).toEqual([true, true]);
    expect((await seances())[0]).toMatchObject({ presents: 2, absents: 0 });
  });

  it("refuse un danseur absent de la liste d’appel", async () => {
    const [s] = await seances();
    expect(
      await avecEcole(ecole, (tx) => enregistrerAppel(tx, s.id, [{ danseurId: danseurs["Jules"], present: true }])),
    ).toEqual({
      ok: false,
      message: "Un des danseurs ne suit pas ce cours.",
    });
  });

  it("ne retire jamais une séance dont l’appel est fait", async () => {
    await avecEcole(ecole, (tx) =>
      ajouterFermeture(tx, saison, { libelle: "Grève", debut: "2026-10-21", fin: "2026-10-21" }),
    );
    expect(await synchroniser()).toEqual({ ajoutees: 0, retirees: 0 });
    expect((await dates())[0]).toBe("2026-10-21");
  });
});

describe("remplacement et annulation", () => {
  it("met un remplaçant actif sur une séance, refuse un inactif", async () => {
    const s = (await seances())[1];
    expect(await avecEcole(ecole, (tx) => changerIntervenant(tx, s.id, ines))).toEqual({ ok: true, id: s.id });
    expect((await avecEcole(ecole, (tx) => lireAppel(tx, s.id)))?.intervenantId).toBe(ines);
    expect(await avecEcole(ecole, (tx) => changerIntervenant(tx, s.id, inactif))).toEqual({
      ok: false,
      message: "Intervenant introuvable ou inactif.",
    });
  });

  it("annule une séance sans appel, refuse si l’appel est fait, et refuse l’appel d’une séance annulée", async () => {
    const [faite, prevue] = await seances();
    expect(await avecEcole(ecole, (tx) => annulerSeance(tx, faite.id))).toEqual({
      ok: false,
      message: "L’appel de cette séance est déjà fait.",
    });
    expect(await avecEcole(ecole, (tx) => annulerSeance(tx, prevue.id))).toEqual({ ok: true, id: prevue.id });
    expect(
      await avecEcole(ecole, (tx) => enregistrerAppel(tx, prevue.id, [{ danseurId: danseurs["Léa"], present: true }])),
    ).toEqual({
      ok: false,
      message: "Cette séance est annulée.",
    });
    // Une séance annulée n'est ni recréée ni retirée par la synchronisation.
    await synchroniser();
    expect((await seances())[1]).toMatchObject({ id: prevue.id, statut: "annulee" });
  });

  it("donne les séances du jour, sans celles d’une autre école", async () => {
    const jour = await avecEcole(ecole, (tx) => seancesDuJour(tx, "2026-11-04"));
    expect(jour.map((s) => `${s.heureDebut} ${s.discipline} ${s.appelFait}`)).toEqual(["17:00 Jazz false"]);
    expect(await avecEcole(autreEcole, (tx) => seancesDuJour(tx, "2026-11-04"))).toEqual([]);
    expect(await avecEcole(autreEcole, (tx) => lireAppel(tx, jour[0].id))).toBeNull();
  });
});

describe("cours et séances", () => {
  it("un nouveau titulaire reprend les séances prévues de l’ancien, pas celles d’un remplaçant", async () => {
    const avant = await seances();
    const cours = await avecEcole(ecole, (tx) => lireCours(tx, mercredi));
    if (!cours) throw new Error("cours introuvable");
    const {
      type,
      recurrence,
      jourSemaine,
      dateDebut,
      dateFin,
      dates,
      heureDebut,
      dureeMinutes,
      ageMin,
      ageMax,
      niveau,
      capaciteMax,
    } = cours;
    const saisie = {
      type,
      recurrence,
      jourSemaine,
      dateDebut,
      dateFin,
      dates,
      heureDebut,
      dureeMinutes,
      ageMin,
      ageMax,
      niveau,
      capaciteMax,
    };
    const r = await avecEcole(ecole, (tx) =>
      modifierCours(tx, mercredi, {
        ...saisie,
        discipline: { id: cours.disciplineId },
        salle: { id: cours.salleId },
        intervenantId: ines,
      }),
    );
    expect(r.ok).toBe(true);
    const apres = await seances();
    // Séance faite (Camille) inchangée ; séances prévues de Camille passées à Inès.
    expect(apres[0].intervenant).toBe(avant[0].intervenant);
    expect(apres.filter((s) => s.statut === "prevue").every((s) => s.intervenant === "Inès Prof")).toBe(true);
  });

  it("refuse de supprimer un cours dont l’appel a été fait", async () => {
    await admin`DELETE FROM enrollment_course WHERE course_id = ${mercredi}`;
    expect(await avecEcole(ecole, (tx) => supprimerCours(tx, mercredi))).toEqual({
      ok: false,
      message: "Des appels ont été faits pour ce cours : il ne peut pas être supprimé.",
    });
  });
});

describe("récurrences (#90)", () => {
  const datesDe = async (coursId: string) =>
    (await admin`SELECT date::text AS date FROM lesson WHERE course_id = ${coursId} ORDER BY date`).map(
      (r) => r.date as string,
    );

  it("une semaine sur deux, sur une période, et à dates précises (vacances comprises)", async () => {
    const modele = await avecEcole(ecole, (tx) => lireCours(tx, mercredi));
    if (!modele) throw new Error("cours introuvable");
    const base = {
      discipline: { id: modele.disciplineId },
      salle: { id: modele.salleId },
      intervenantId: camille,
      type: "collectif" as const,
      heureDebut: "10:00",
      dureeMinutes: 60,
      ageMin: null,
      ageMax: null,
      niveau: null,
      capaciteMax: null,
      dateDebut: null,
      dateFin: null,
      dates: [],
    };
    const fermetures = (await avecEcole(ecole, (tx) => listerFermetures(tx, saison))).map(({ debut, fin }) => ({
      debut,
      fin,
    }));
    const creer = (saisie: Parameters<typeof creerCours>[2]) =>
      avecEcole(ecole, async (tx) => {
        const r = await creerCours(tx, saison, saisie);
        if (!r.ok) throw new Error(r.message);
        return r.id;
      });
    const quinzaine = await creer({ ...base, recurrence: "quinzaine", jourSemaine: 1 });
    const periode = await creer({
      ...base,
      recurrence: "hebdomadaire",
      jourSemaine: 2,
      dateDebut: "2026-11-01",
      dateFin: "2026-11-17",
    });
    const stage = await creer({
      ...base,
      type: "stage",
      recurrence: "dates",
      jourSemaine: null,
      dates: ["2026-11-21", "2026-10-26", "2026-10-26"],
    });
    await synchroniser();

    const saisonEntiere = { debut: "2026-09-01", fin: "2026-11-30" };
    expect(await datesDe(quinzaine)).toEqual(
      datesDuCours(
        { type: "quinzaine", jourSemaine: 1, dateDebut: null, dateFin: null },
        saisonEntiere,
        fermetures,
      ).filter((d) => d >= AUJOURDHUI),
    );
    expect(await datesDe(periode)).toEqual(
      datesDuCours(
        { type: "hebdomadaire", jourSemaine: 2, dateDebut: "2026-11-01", dateFin: "2026-11-17" },
        saisonEntiere,
        fermetures,
      ),
    );
    expect(await datesDe(stage)).toEqual(["2026-10-26", "2026-11-21"]);
    expect((await avecEcole(ecole, (tx) => lireCours(tx, stage)))?.dates).toEqual(["2026-10-26", "2026-11-21"]);

    // Le stage passe à une seule date : la séance retirée disparaît.
    await avecEcole(ecole, async (tx) => {
      const c = await lireCours(tx, stage);
      if (!c) throw new Error("stage introuvable");
      const {
        type,
        recurrence,
        jourSemaine,
        dateDebut,
        dateFin,
        heureDebut,
        dureeMinutes,
        ageMin,
        ageMax,
        niveau,
        capaciteMax,
      } = c;
      await modifierCours(tx, stage, {
        type,
        recurrence,
        jourSemaine,
        dateDebut,
        dateFin,
        heureDebut,
        dureeMinutes,
        ageMin,
        ageMax,
        niveau,
        capaciteMax,
        dates: ["2026-11-21"],
        discipline: { id: c.disciplineId },
        salle: { id: c.salleId },
        intervenantId: c.intervenantId,
      });
    });
    await synchroniser();
    expect(await datesDe(stage)).toEqual(["2026-11-21"]);

    for (const id of [quinzaine, periode, stage])
      expect((await avecEcole(ecole, (tx) => supprimerCours(tx, id))).ok).toBe(true);
  });
});

describe("planning daté : déplacer une séance (#90)", () => {
  let lundi: string;
  const liste = async () =>
    (
      await admin`SELECT id, date::text AS date, planned_date::text AS prevue, to_char(start_time, 'HH24:MI') AS heure, instructor_id AS prof
        FROM lesson WHERE course_id = ${lundi} ORDER BY date`
    ).map((r) => ({
      id: r.id as string,
      date: r.date as string,
      prevue: r.prevue as string | null,
      heure: r.heure as string | null,
      prof: r.prof as string,
    }));
  const deplacer = (
    id: string,
    creneau: { date: string; heureDebut: string; dureeMinutes: number },
    portee: "seance" | "suivantes",
  ) =>
    avecEcole(ecole, async (tx) => {
      const r = await deplacerSeance(tx, id, creneau, portee);
      if (r.statut === "ok") await synchroniserSeances(tx, r.saisonId, AUJOURDHUI, r.depuis ?? undefined);
      return r;
    });

  beforeAll(async () => {
    const modele = await admin`SELECT discipline_id, room_id FROM course WHERE id = ${mercredi}`;
    [{ id: lundi }] =
      await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${ecole}, ${saison}, ${modele[0].discipline_id}, ${modele[0].room_id}, ${camille}, 1, '10:00', 60) RETURNING id`;
    await synchroniser();
  });

  it("cette séance seulement : elle change de jour et d'heure, sans être recréée à sa date d'origine", async () => {
    const avant = await liste();
    const cible = avant[1];
    expect(
      await deplacer(cible.id, { date: "2026-10-27", heureDebut: "11:30", dureeMinutes: 60 }, "seance"),
    ).toMatchObject({ statut: "ok" });
    await synchroniser();
    const apres = await liste();
    expect(apres).toHaveLength(avant.length);
    expect(apres.find((x) => x.id === cible.id)).toMatchObject({
      date: "2026-10-27",
      prevue: cible.date,
      heure: "11:30",
    });
    const semaine = await avecEcole(ecole, (tx) => seancesDeLaSemaine(tx, "2026-10-26"));
    expect(semaine.find((x) => x.id === cible.id)).toMatchObject({ heureDebut: "11:30", deplacee: true });
  });

  it("refuse une date déjà prise par le cours, hors saison, ou une séance annulée", async () => {
    const [a, b] = await liste();
    expect(await deplacer(a.id, { date: b.date, heureDebut: "10:00", dureeMinutes: 60 }, "seance")).toEqual({
      statut: "refus",
      message: "Ce cours a déjà une séance ce jour-là.",
    });
    expect(await deplacer(a.id, { date: "2027-01-04", heureDebut: "10:00", dureeMinutes: 60 }, "seance")).toEqual({
      statut: "refus",
      message: "Cette date est en dehors de la saison.",
    });
    await avecEcole(ecole, (tx) => annulerSeance(tx, a.id));
    expect((await deplacer(a.id, { date: "2026-10-20", heureDebut: "10:00", dureeMinutes: 60 }, "seance")).statut).toBe(
      "refus",
    );
  });

  it("cette séance et les suivantes : le cours change, les précédentes gardent leur heure, le remplaçant reste", async () => {
    const avant = await liste();
    const [, , pivot, ensuite] = avant;
    await avecEcole(ecole, (tx) => changerIntervenant(tx, ensuite.id, ines));
    const r = await deplacer(
      pivot.id,
      { date: ajouterJours(pivot.date, 1), heureDebut: "18:30", dureeMinutes: 90 },
      "suivantes",
    );
    expect(r).toMatchObject({ statut: "ok" });
    const [c] =
      await admin`SELECT weekday, to_char(start_time, 'HH24:MI') AS h, duration_minutes FROM course WHERE id = ${lundi}`;
    expect(c).toMatchObject({ weekday: 2, h: "18:30", duration_minutes: 90 });
    const apres = await liste();
    // Avant le pivot : toujours le lundi, heure d'origine figée (sauf la séance déjà déplacée).
    for (const x of apres.filter((x) => (x.prevue ?? x.date) < pivot.date))
      expect(x.heure === "10:00" || x.heure === "11:30").toBe(true);
    // À partir du pivot : le mardi, à l'heure du cours ; le remplaçant de la séance suivante est gardé.
    const suivantes = apres.filter((x) => x.date > pivot.date);
    expect(suivantes.every((x) => new Date(`${x.date}T00:00:00Z`).getUTCDay() === 2 && x.heure === null)).toBe(true);
    expect(apres.find((x) => x.id === ensuite.id)?.prof).toBe(ines);
  });
});
