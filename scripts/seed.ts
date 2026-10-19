/**
 * Données de DÉMONSTRATION pour le développement local : une école fictive et
 * deux comptes (accueil, direction). Idempotent. Ne jamais lancer en production.
 *
 *   npm run db:seed
 */
import postgres from "postgres";
import { creerCompte } from "../src/lib/comptes";

const MOT_DE_PASSE = process.env.SEED_MOT_DE_PASSE ?? "demo-ecole-de-danse";
const COMPTES = [
  { email: "accueil@demo.test", nom: "Accueil Démo", role: "accueil" },
  { email: "direction@demo.test", nom: "Direction Démo", role: "direction" },
] as const;

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

  // Familles fictives (aucune personne réelle), créées une seule fois.
  const [{ n }] = await admin`SELECT count(*)::int AS n FROM payeur WHERE ecole_id = ${ecole.id}`;
  if (n === 0) {
    for (const f of FAMILLES) {
      const [p] = await admin`
        INSERT INTO payeur (ecole_id, type, nom, prenom, raison_sociale, siren, email, telephone, adresse)
        VALUES (${ecole.id}, ${f.type ?? "particulier"}, ${f.nom}, ${f.prenom ?? null}, ${f.raisonSociale ?? null},
                ${f.siren ?? null}, ${f.email ?? null}, ${f.telephone ?? null}, ${f.adresse ?? null})
        RETURNING id`;
      for (const [prenom, naissance] of f.danseurs) {
        await admin`
          INSERT INTO danseur (ecole_id, payeur_id, nom, prenom, date_naissance)
          VALUES (${ecole.id}, ${p.id}, ${f.nom}, ${prenom}, ${naissance})`;
      }
    }
  }

  console.log(`École de démonstration prête. Comptes : ${COMPTES.map((c) => c.email).join(", ")}`);
  console.log(`Mot de passe : ${process.env.SEED_MOT_DE_PASSE ? "(SEED_MOT_DE_PASSE)" : MOT_DE_PASSE}`);
}

principal()
  .finally(() => admin.end())
  .then(() => process.exit(0));
