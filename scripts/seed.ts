/**
 * Données de DÉMONSTRATION pour le développement local : une école fictive et
 * deux comptes (accueil, direction). Idempotent. Ne jamais lancer en production.
 *
 *   npm run db:seed
 */
import postgres from "postgres";
import { avecEcole } from "../src/db";
import { synchroniserSeances } from "../src/db/seances";
import { aujourdhuiAParis } from "../src/domaine/personnes/age";
import { creerCompte } from "../src/lib/comptes";

const MOT_DE_PASSE = process.env.SEED_MOT_DE_PASSE ?? "demo-ecole-de-danse";
const COMPTES = [
  { email: "accueil@demo.test", nom: "Accueil Démo", role: "accueil" },
  { email: "direction@demo.test", nom: "Direction Démo", role: "direction" },
] as const;

/** Un payeur et les danseurs dont il paie les cours. */
type FamilleDemo = {
  nom: string;
  prenom?: string;
  type?: "particulier" | "professionnel";
  raisonSociale?: string;
  siren?: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  danseurs: [prenom: string, naissance: string | null][];
};

const FAMILLES: FamilleDemo[] = [
  { nom: "Lefèvre", prenom: "Hélène", email: "helene.lefevre@demo.test", telephone: "06 12 34 56 78", adresse: "12 rue des Lilas, 69100 Villeurbanne", danseurs: [["Zoé", "2015-03-10"], ["Noé", "2017-11-02"]] },
  { nom: "Martin", prenom: "Paul", email: "paul.martin@demo.test", telephone: "06 98 76 54 32", danseurs: [["Léa", "2014-06-21"]] },
  { nom: "Bernard", prenom: "Émilie", telephone: "07 11 22 33 44", danseurs: [["Alice", "2016-01-15"], ["Louis", "2016-01-15"], ["Jules", "2019-09-30"]] },
  { nom: "Rivière", prenom: "Alex", email: "alex.riviere@demo.test", danseurs: [["Alex", "1996-04-05"]] },
  { nom: "Petit", prenom: "Sarah", telephone: "06 55 44 33 22", danseurs: [["Chloé", "2013-12-24"]] },
  { nom: "Ateliers Démo", type: "professionnel", raisonSociale: "CSE des Ateliers Démo", siren: "000000000", email: "cse@demo.test", danseurs: [] },
];

if (process.env.NODE_ENV === "production") throw new Error("Données de démonstration refusées en production");
const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

async function principal() {
  const [ecole] = await admin`
    INSERT INTO ecole (nom, slug) VALUES ('École de démonstration', 'demo')
    ON CONFLICT (slug) DO UPDATE SET nom = EXCLUDED.nom
    RETURNING id`;
  await admin`
    INSERT INTO saison (ecole_id, libelle, date_debut, date_fin)
    VALUES (${ecole.id}, '2026-2027', '2026-09-01', '2027-06-30')
    ON CONFLICT DO NOTHING`;

  for (const compte of COMPTES) {
    const [existant] = await admin`SELECT id FROM "user" WHERE email = ${compte.email}`;
    const userId: string =
      existant?.id ?? (await creerCompte({ email: compte.email, nom: compte.nom, motDePasse: MOT_DE_PASSE }));
    await admin`
      INSERT INTO membre (ecole_id, user_id, role) VALUES (${ecole.id}, ${userId}, ${compte.role})
      ON CONFLICT (ecole_id, user_id) DO NOTHING`;
  }

  // Personnes fictives (aucune personne réelle), créées une seule fois. Un danseur
  // qui porte le prénom du payeur est le payeur lui-même (adulte seul).
  const [{ n }] = await admin`SELECT count(*)::int AS n FROM personne WHERE ecole_id = ${ecole.id}`;
  if (n === 0) {
    for (const f of FAMILLES) {
      const [p] = await admin`
        INSERT INTO personne (ecole_id, type, nom, prenom, raison_sociale, siren, email, telephone, adresse)
        VALUES (${ecole.id}, ${f.type ?? "particulier"}, ${f.nom}, ${f.prenom ?? null}, ${f.raisonSociale ?? null},
                ${f.siren ?? null}, ${f.email ?? null}, ${f.telephone ?? null}, ${f.adresse ?? null})
        RETURNING id`;
      for (const [prenom, naissance] of f.danseurs) {
        if (prenom === f.prenom) {
          await admin`UPDATE personne SET date_naissance = ${naissance} WHERE id = ${p.id}`;
          continue;
        }
        const [d] = await admin`
          INSERT INTO personne (ecole_id, nom, prenom, date_naissance)
          VALUES (${ecole.id}, ${f.nom}, ${prenom}, ${naissance}) RETURNING id`;
        await admin`
          INSERT INTO lien (ecole_id, personne_id, lie_a_id, type, paie_pour, contact_urgence)
          VALUES (${ecole.id}, ${p.id}, ${d.id}, 'representant_legal', true, true)`;
      }
    }
  }

  // Planning fictif : sites, salles, disciplines, professeurs, cours de la saison.
  const [saison] = await admin`SELECT id FROM saison WHERE ecole_id = ${ecole.id} AND libelle = '2026-2027'`;
  const [{ nbCours }] = await admin`SELECT count(*)::int AS "nbCours" FROM cours WHERE saison_id = ${saison.id}`;
  if (nbCours === 0) {
    const sites: Record<string, string> = {};
    for (const [nom, adresse, permanence] of [
      ["Site Centre", "3 place de la Mairie, 69100 Villeurbanne", true],
      ["Site Nord", "40 avenue des Arts, 69100 Villeurbanne", false],
    ] as const) {
      const [s] = await admin`INSERT INTO site (ecole_id, nom, adresse, permanence) VALUES (${ecole.id}, ${nom}, ${adresse}, ${permanence}) RETURNING id`;
      sites[nom] = s.id;
    }
    const salles: Record<string, string> = {};
    for (const [nom, site, capacite] of [
      ["Grande salle", "Site Centre", 30],
      ["Petite salle", "Site Centre", 15],
      ["Studio", "Site Nord", 20],
    ] as const) {
      const [s] = await admin`INSERT INTO salle (ecole_id, site_id, nom, capacite) VALUES (${ecole.id}, ${sites[site]}, ${nom}, ${capacite}) RETURNING id`;
      salles[nom] = s.id;
    }
    const disciplines: Record<string, string> = {};
    for (const nom of ["Éveil", "Classique", "Jazz", "Contemporain", "Zumba", "Salsa"]) {
      const [d] = await admin`INSERT INTO discipline (ecole_id, nom) VALUES (${ecole.id}, ${nom})
        ON CONFLICT (ecole_id, nom) DO UPDATE SET nom = EXCLUDED.nom RETURNING id`;
      disciplines[nom] = d.id;
    }
    const profs: Record<string, string> = {};
    for (const [prenom, nom, statut, mode, tarif] of [
      ["Camille", "Durand", "micro_entreprise", "heure", 4000],
      ["Mathis", "Roux", "micro_entreprise", "cours", 3500],
      ["Inès", "Garnier", "salarie", "heure", 2800],
      ["Lucas", "Faure", "societe", "heure", 4500],
    ] as const) {
      const [p] = await admin`
        INSERT INTO intervenant (ecole_id, nom, prenom, statut, regime_tva, mode_remuneration, tarif_centimes)
        VALUES (${ecole.id}, ${nom}, ${prenom}, ${statut}, 'non_applicable', ${mode}, ${tarif}) RETURNING id`;
      profs[prenom] = p.id;
    }
    // [discipline, salle, prof, jour (1 = lundi), heure, durée, âge min, âge max, niveau]
    const COURS = [
      ["Éveil", "Petite salle", "Inès", 3, "14:00", 45, 4, 5, null],
      ["Éveil", "Petite salle", "Inès", 6, "10:00", 45, 4, 5, null],
      ["Classique", "Grande salle", "Camille", 3, "15:00", 60, 6, 8, "Débutant"],
      ["Classique", "Grande salle", "Camille", 3, "16:15", 60, 9, 12, "Intermédiaire"],
      ["Classique", "Grande salle", "Camille", 5, "17:30", 90, 13, null, "Avancé"],
      ["Jazz", "Grande salle", "Mathis", 1, "17:00", 60, 8, 11, null],
      ["Jazz", "Studio", "Mathis", 2, "18:00", 60, 12, 15, null],
      ["Jazz", "Studio", "Mathis", 4, "19:30", 90, 16, null, "Adultes"],
      ["Contemporain", "Studio", "Inès", 2, "19:15", 90, 16, null, "Adultes"],
      ["Contemporain", "Grande salle", "Camille", 6, "11:00", 60, 10, 14, null],
      ["Zumba", "Grande salle", "Lucas", 1, "19:00", 60, 16, null, "Adultes"],
      ["Zumba", "Grande salle", "Lucas", 4, "19:00", 60, 16, null, "Adultes"],
      ["Salsa", "Studio", "Lucas", 3, "20:00", 60, 18, null, "Débutant"],
      ["Salsa", "Studio", "Lucas", 5, "20:00", 90, 18, null, "Intermédiaire"],
    ] as const;
    for (const [d, salle, prof, jour, heure, duree, ageMin, ageMax, niveau] of COURS) {
      await admin`
        INSERT INTO cours (ecole_id, saison_id, discipline_id, salle_id, intervenant_id, jour_semaine, heure_debut, duree_minutes, age_min, age_max, niveau)
        VALUES (${ecole.id}, ${saison.id}, ${disciplines[d]}, ${salles[salle]}, ${profs[prof]}, ${jour}, ${heure}, ${duree}, ${ageMin}, ${ageMax}, ${niveau})`;
    }
  }

  // Capacité des cours de démonstration : celle de leur salle, si elle n'est pas renseignée.
  await admin`
    UPDATE cours SET capacite_max = s.capacite FROM salle s
    WHERE cours.salle_id = s.id AND cours.ecole_id = ${ecole.id} AND cours.capacite_max IS NULL`;

  // Grille tarifaire et réduction fratrie de démonstration (montants en euros).
  const [{ nbTarifs }] = await admin`SELECT count(*)::int AS "nbTarifs" FROM tarif WHERE saison_id = ${saison.id}`;
  if (nbTarifs === 0) {
    const GRILLE: [publicTarif: string, combinaison: number[], trimestre: number, annee: number][] = [
      ["enfant", [45], 85, 210],
      ["enfant", [60], 110, 280],
      ["enfant", [90], 150, 380],
      ["enfant", [45, 60], 165, 415],
      ["enfant", [60, 60], 185, 475],
      ["enfant", [60, 90], 220, 560],
      ["enfant", [45, 90], 200, 500],
      ["enfant", [90, 90], 255, 645],
      ["enfant", [60, 60, 60], 230, 590],
      ["adulte", [60], 120, 305],
      ["adulte", [90], 165, 420],
      ["adulte", [60, 60], 205, 520],
      ["adulte", [60, 90], 240, 615],
      ["adulte", [90, 90], 280, 715],
      ["couple", [60], 230, 550],
      ["couple", [90], 295, 755],
      ["etudiant", [60], 115, 290],
      ["etudiant", [90], 155, 400],
    ];
    for (const [publicTarif, combinaison, trimestre, annee] of GRILLE) {
      for (const [periodicite, euros] of [["trimestre", trimestre], ["annee", annee]] as const) {
        await admin`
          INSERT INTO tarif (ecole_id, saison_id, public, periodicite, combinaison, prix_centimes)
          VALUES (${ecole.id}, ${saison.id}, ${publicTarif}, ${periodicite}, ${`{${combinaison.join(",")}}`}::smallint[], ${euros * 100})`;
      }
    }
    await admin`
      INSERT INTO reduction (ecole_id, saison_id, code, taux_points_base, seuil_danseurs, publics, cumulable_multi_disciplines)
      VALUES (${ecole.id}, ${saison.id}, 'fratrie', 1000, 2, '{enfant}', false)`;
  }

  // Fermetures de démonstration (dates fictives) puis séances à venir, comme l'application les crée.
  const [{ nbFermetures }] = await admin`SELECT count(*)::int AS "nbFermetures" FROM fermeture WHERE saison_id = ${saison.id}`;
  if (nbFermetures === 0) {
    for (const [libelle, debut, fin] of [
      ["Vacances d’automne", "2026-10-17", "2026-11-01"],
      ["Jour férié", "2026-11-11", "2026-11-11"],
      ["Vacances de fin d’année", "2026-12-19", "2027-01-03"],
    ]) {
      await admin`INSERT INTO fermeture (ecole_id, saison_id, libelle, debut, fin) VALUES (${ecole.id}, ${saison.id}, ${libelle}, ${debut}, ${fin})`;
    }
  }
  const { ajoutees } = await avecEcole(ecole.id, (tx) => synchroniserSeances(tx, saison.id, aujourdhuiAParis()));
  console.log(`Séances à venir créées : ${ajoutees}`);

  console.log(`École de démonstration prête. Comptes : ${COMPTES.map((c) => c.email).join(", ")}`);
  console.log(`Mot de passe : ${process.env.SEED_MOT_DE_PASSE ? "(SEED_MOT_DE_PASSE)" : MOT_DE_PASSE}`);
}

principal()
  .finally(() => admin.end())
  .then(() => process.exit(0));
