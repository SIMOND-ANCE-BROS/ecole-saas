import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  creerCours,
  deplacerCours,
  lireCours,
  modifierCours,
  referentielPlanning,
  type SaisieCours,
  supprimerCours,
} from "./cours";
import { avecEcole } from "./index";

/** Édition du planning, comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
let ecole: string;
let autreEcole: string;
let saison: string;
let site: string;
let salle: string;
let prof: string;
let profInactif: string;
let salleEtrangere: string;
let base: SaisieCours;

const INTERVENANT = `(ecole_id, nom, prenom, statut, regime_tva, mode_remuneration, tarif_centimes, actif)`;

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École A', ${`ca-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École B', ${`cb-${suffixe}`}) RETURNING id`;
  [{ id: saison }] = await admin`INSERT INTO saison (ecole_id, libelle, date_debut, date_fin)
    VALUES (${ecole}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: site }] =
    await admin`INSERT INTO site (ecole_id, nom, adresse) VALUES (${ecole}, 'Centre', '1 rue Test') RETURNING id`;
  [{ id: salle }] =
    await admin`INSERT INTO salle (ecole_id, site_id, nom, capacite) VALUES (${ecole}, ${site}, 'Studio', 20) RETURNING id`;
  [{ id: prof }] = await admin.unsafe(
    `INSERT INTO intervenant ${INTERVENANT}
    VALUES ($1, 'Durand', 'Camille', 'salarie', 'non_applicable', 'heure', 3000, true) RETURNING id`,
    [ecole],
  );
  [{ id: profInactif }] = await admin.unsafe(
    `INSERT INTO intervenant ${INTERVENANT}
    VALUES ($1, 'Ancien', 'Prof', 'salarie', 'non_applicable', 'heure', 3000, false) RETURNING id`,
    [ecole],
  );
  const [s] =
    await admin`INSERT INTO site (ecole_id, nom, adresse) VALUES (${autreEcole}, 'Ailleurs', '2 rue Test') RETURNING id`;
  [{ id: salleEtrangere }] =
    await admin`INSERT INTO salle (ecole_id, site_id, nom) VALUES (${autreEcole}, ${s.id}, 'Autre') RETURNING id`;
  base = {
    discipline: { nom: "Jazz" },
    salle: { id: salle },
    intervenantId: prof,
    type: "collectif",
    recurrence: "hebdomadaire",
    jourSemaine: 3,
    dateDebut: null,
    dateFin: null,
    dates: [],
    heureDebut: "17:00",
    dureeMinutes: 60,
    ageMin: 8,
    ageMax: 11,
    niveau: "Débutant",
    capaciteMax: 18,
  };
});

afterAll(async () => {
  for (const t of [
    "inscription_cours",
    "inscription",
    "lien",
    "personne",
    "cours",
    "salle",
    "site",
    "discipline",
    "intervenant",
    "saison",
  ]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE ecole_id IN ($1, $2)`, [ecole, autreEcole]);
  }
  await admin`DELETE FROM ecole WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

describe("creerCours", () => {
  it("crée le cours et la discipline nouvelle, puis le relit", async () => {
    const r = await avecEcole(ecole, (tx) => creerCours(tx, saison, base));
    expect(r.ok).toBe(true);
    const id = r.ok ? r.id : "";
    const lu = await avecEcole(ecole, (tx) => lireCours(tx, id));
    expect(lu).toMatchObject({
      salleId: salle,
      intervenantId: prof,
      jourSemaine: 3,
      heureDebut: "17:00",
      capaciteMax: 18,
      niveau: "Débutant",
    });
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM discipline WHERE ecole_id = ${ecole} AND nom = 'Jazz'`;
    expect(n).toBe(1);
  });

  it("réutilise une discipline existante, sans tenir compte de la casse", async () => {
    await avecEcole(ecole, (tx) => creerCours(tx, saison, { ...base, discipline: { nom: " jazz " }, jourSemaine: 5 }));
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM discipline WHERE ecole_id = ${ecole}`;
    expect(n).toBe(1);
  });

  it("crée une salle et un site à la volée", async () => {
    const r = await avecEcole(ecole, (tx) =>
      creerCours(tx, saison, {
        ...base,
        salle: { nom: "Salle bleue", capacite: 12, site: { nom: "Nord", adresse: "40 avenue des Arts" } },
      }),
    );
    expect(r.ok).toBe(true);
    const [s] =
      await admin`SELECT s.nom, s.capacite, si.nom AS site FROM salle s JOIN site si ON si.id = s.site_id WHERE s.ecole_id = ${ecole} AND s.nom = 'Salle bleue'`;
    expect(s).toMatchObject({ capacite: 12, site: "Nord" });
  });

  it("refuse une salle d’une autre école", async () => {
    const r = await avecEcole(ecole, (tx) => creerCours(tx, saison, { ...base, salle: { id: salleEtrangere } }));
    expect(r).toEqual({ ok: false, message: "Salle introuvable." });
  });

  it("refuse un intervenant inactif pour un nouveau cours", async () => {
    const r = await avecEcole(ecole, (tx) => creerCours(tx, saison, { ...base, intervenantId: profInactif }));
    expect(r).toEqual({ ok: false, message: "Intervenant introuvable ou inactif." });
  });
});

describe("modifierCours", () => {
  it("modifie l’horaire et la capacité", async () => {
    const r = await avecEcole(ecole, (tx) => creerCours(tx, saison, base));
    const id = r.ok ? r.id : "";
    const m = await avecEcole(ecole, (tx) =>
      modifierCours(tx, id, { ...base, heureDebut: "18:15", capaciteMax: null }),
    );
    expect(m).toEqual({ ok: true, id });
    expect(await avecEcole(ecole, (tx) => lireCours(tx, id))).toMatchObject({ heureDebut: "18:15", capaciteMax: null });
  });

  it("garde un intervenant devenu inactif s’il était déjà sur le cours", async () => {
    const r = await avecEcole(ecole, (tx) => creerCours(tx, saison, base));
    const id = r.ok ? r.id : "";
    await admin`UPDATE cours SET intervenant_id = ${profInactif} WHERE id = ${id}`;
    const m = await avecEcole(ecole, (tx) =>
      modifierCours(tx, id, { ...base, intervenantId: profInactif, niveau: "Moyen" }),
    );
    expect(m.ok).toBe(true);
  });

  it("ne modifie pas un cours inconnu", async () => {
    const m = await avecEcole(autreEcole, (tx) => modifierCours(tx, "00000000-0000-4000-8000-000000000000", base));
    expect(m).toEqual({ ok: false, message: "Ce cours n’existe plus." });
  });
});

describe("supprimerCours", () => {
  it("supprime un cours sans inscrit", async () => {
    const r = await avecEcole(ecole, (tx) => creerCours(tx, saison, base));
    const id = r.ok ? r.id : "";
    expect(await avecEcole(ecole, (tx) => supprimerCours(tx, id))).toEqual({ ok: true, id });
    expect(await avecEcole(ecole, (tx) => lireCours(tx, id))).toBeNull();
  });

  it("refuse de supprimer un cours avec des inscrits", async () => {
    const r = await avecEcole(ecole, (tx) => creerCours(tx, saison, base));
    const id = r.ok ? r.id : "";
    const [p] = await admin`INSERT INTO personne (ecole_id, nom) VALUES (${ecole}, 'Martin') RETURNING id`;
    const [d] =
      await admin`INSERT INTO personne (ecole_id, nom, prenom) VALUES (${ecole}, 'Martin', 'Léa') RETURNING id`;
    const [i] = await admin`
      INSERT INTO inscription (ecole_id, saison_id, payeur_id, public, periodicite, prix_brut_centimes, statut)
      VALUES (${ecole}, ${saison}, ${p.id}, 'enfant', 'trimestre', 10000, 'active') RETURNING id`;
    await admin`INSERT INTO inscription_cours (ecole_id, inscription_id, danseur_id, cours_id) VALUES (${ecole}, ${i.id}, ${d.id}, ${id})`;
    expect(await avecEcole(ecole, (tx) => supprimerCours(tx, id))).toEqual({
      ok: false,
      message: "Ce cours a 1 inscription : il ne peut pas être supprimé.",
    });
  });
});

describe("referentielPlanning", () => {
  it("donne disciplines, salles avec leur site et intervenants actifs de l’école", async () => {
    const r = await avecEcole(ecole, (tx) => referentielPlanning(tx));
    expect(r.salles).toContainEqual({ id: salle, nom: "Studio", site: "Centre", siteId: site, capacite: 20 });
    expect(r.salles.map((s) => s.id)).not.toContain(salleEtrangere);
    expect(r.intervenants.map((i) => i.id)).toEqual([prof]);
    expect(r.sites.map((s) => s.nom)).toContain("Centre");
    expect(r.disciplines.map((d) => d.nom)).toContain("Jazz");
  });
});

describe("deplacerCours (vue agenda)", () => {
  it("déplace et étire un cours sans inscrit", async () => {
    const r = await avecEcole(ecole, (tx) => creerCours(tx, saison, base));
    const id = r.ok ? r.id : "";
    expect(
      await avecEcole(ecole, (tx) =>
        deplacerCours(tx, id, { jourSemaine: 4, heureDebut: "18:15", dureeMinutes: 90 }, false),
      ),
    ).toEqual({ statut: "ok", id });
    expect(await avecEcole(ecole, (tx) => lireCours(tx, id))).toMatchObject({
      jourSemaine: 4,
      heureDebut: "18:15",
      dureeMinutes: 90,
    });
  });

  it("demande confirmation quand des élèves sont inscrits, puis déplace", async () => {
    const r = await avecEcole(ecole, (tx) => creerCours(tx, saison, base));
    const id = r.ok ? r.id : "";
    const [p] = await admin`INSERT INTO personne (ecole_id, nom) VALUES (${ecole}, 'Payeur') RETURNING id`;
    const [d] =
      await admin`INSERT INTO personne (ecole_id, nom, prenom) VALUES (${ecole}, 'Petit', 'Lou') RETURNING id`;
    const [i] =
      await admin`INSERT INTO inscription (ecole_id, saison_id, payeur_id, public, periodicite, prix_brut_centimes, statut)
      VALUES (${ecole}, ${saison}, ${p.id}, 'enfant', 'trimestre', 10000, 'active') RETURNING id`;
    await admin`INSERT INTO inscription_cours (ecole_id, inscription_id, danseur_id, cours_id) VALUES (${ecole}, ${i.id}, ${d.id}, ${id})`;
    const creneau = { jourSemaine: 5, heureDebut: "17:00", dureeMinutes: 60 };
    expect(await avecEcole(ecole, (tx) => deplacerCours(tx, id, creneau, false))).toEqual({
      statut: "confirmer",
      inscrits: 1,
    });
    expect((await avecEcole(ecole, (tx) => lireCours(tx, id)))?.jourSemaine).toBe(3);
    expect(await avecEcole(ecole, (tx) => deplacerCours(tx, id, creneau, true))).toEqual({ statut: "ok", id });
    expect((await avecEcole(ecole, (tx) => lireCours(tx, id)))?.jourSemaine).toBe(5);
  });

  it("refuse un cours qui finirait après minuit, un stage, et un cours d’une autre école", async () => {
    const r = await avecEcole(ecole, (tx) => creerCours(tx, saison, base));
    const id = r.ok ? r.id : "";
    expect(
      await avecEcole(ecole, (tx) =>
        deplacerCours(tx, id, { jourSemaine: 3, heureDebut: "23:30", dureeMinutes: 60 }, true),
      ),
    ).toEqual({
      statut: "refus",
      message: "Le cours finirait après minuit.",
    });
    const stage = await avecEcole(ecole, (tx) =>
      creerCours(tx, saison, { ...base, type: "stage", recurrence: "dates", jourSemaine: null, dates: ["2026-10-24"] }),
    );
    expect(
      await avecEcole(ecole, (tx) =>
        deplacerCours(tx, stage.ok ? stage.id : "", { jourSemaine: 3, heureDebut: "10:00", dureeMinutes: 60 }, true),
      ),
    ).toEqual({
      statut: "refus",
      message: "Un cours à dates précises se modifie depuis sa fiche.",
    });
    expect(
      await avecEcole(autreEcole, (tx) =>
        deplacerCours(tx, id, { jourSemaine: 2, heureDebut: "10:00", dureeMinutes: 60 }, true),
      ),
    ).toEqual({
      statut: "refus",
      message: "Ce cours n’existe plus.",
    });
  });
});
