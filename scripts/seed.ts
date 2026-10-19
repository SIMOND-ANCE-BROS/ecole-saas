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

  console.log(`École de démonstration prête. Comptes : ${COMPTES.map((c) => c.email).join(", ")}`);
  console.log(`Mot de passe : ${process.env.SEED_MOT_DE_PASSE ? "(SEED_MOT_DE_PASSE)" : MOT_DE_PASSE}`);
}

principal()
  .finally(() => admin.end())
  .then(() => process.exit(0));
