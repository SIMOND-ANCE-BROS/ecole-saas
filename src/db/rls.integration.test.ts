import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Garde-fou : toute table du schéma public portant `school_id` doit avoir la
 * Row Level Security activée ET forcée, et une politique `school_isolation`
 * valable pour toutes les commandes.
 *
 * Exécuté contre la vraie base (npm run test:integration), après les migrations.
 * On lit le catalogue (pg_class, pg_attribute, pg_policy) et non
 * information_schema : ce dernier masque les tables sur lesquelles le rôle
 * n'a aucun droit, précisément le cas d'une table oubliée.
 */

type TableEcole = {
  table: string;
  rls_activee: boolean;
  rls_forcee: boolean;
  politique: boolean;
  politique_toutes_commandes: boolean;
  /** USING and WITH CHECK both compare school_id with the setting app.school_id. */
  politique_lit_ecole: boolean;
};

const REQUETE_TABLES_ECOLE = `
  SELECT c.relname AS table,
         c.relrowsecurity AS rls_activee,
         c.relforcerowsecurity AS rls_forcee,
         p.polname IS NOT NULL AS politique,
         coalesce(p.polcmd = '*', false) AS politique_toutes_commandes,
         coalesce(
           pg_get_expr(p.polqual, p.polrelid) LIKE '%school_id = (NULLIF(current_setting(''app.school_id''%'
           AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%school_id = (NULLIF(current_setting(''app.school_id''%',
           false
         ) AS politique_lit_ecole
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'school_id' AND NOT a.attisdropped
  LEFT JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = 'school_isolation'
  WHERE c.relkind IN ('r', 'p')
  ORDER BY c.relname
`;

function defauts(tables: TableEcole[]): string[] {
  return tables.flatMap((t) => {
    const manques = [
      !t.rls_activee && "RLS non activée (ENABLE ROW LEVEL SECURITY)",
      !t.rls_forcee && "RLS non forcée (FORCE ROW LEVEL SECURITY)",
      !t.politique && "politique school_isolation absente",
      t.politique && !t.politique_toutes_commandes && "school_isolation ne couvre pas toutes les commandes",
      t.politique && !t.politique_lit_ecole && "school_isolation ne compare pas school_id au réglage app.school_id",
    ].filter(Boolean);
    return manques.length ? [`${t.table} : ${manques.join(", ")}`] : [];
  });
}

function connexion(variable: "DATABASE_URL" | "DATABASE_ADMIN_URL") {
  const url = process.env[variable];
  if (!url) throw new Error(`${variable} manquante : copier .env.example en .env`);
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** Lancée pour annuler la transaction du test témoin tout en renvoyant son résultat. */
class Annulation extends Error {
  constructor(readonly resultat: string[]) {
    super("annulation volontaire");
  }
}

const app = connexion("DATABASE_URL");
const admin = connexion("DATABASE_ADMIN_URL");

afterAll(async () => {
  await Promise.all([app.end(), admin.end()]);
});

describe("Row Level Security", () => {
  it("protège toutes les tables portant school_id", async () => {
    const tables = await app.unsafe<TableEcole[]>(REQUETE_TABLES_ECOLE);

    // Base vide ou migrations non appliquées : le test ne doit pas passer à vide.
    expect(tables.length, "aucune table avec school_id : migrations appliquées ?").toBeGreaterThan(0);
    expect(defauts(tables)).toEqual([]);
  });

  it("détecte une table portant school_id sans RLS", async () => {
    // Vérifie le garde-fou lui-même : une table oubliée doit être signalée.
    const erreurs = await admin
      .begin(async (tx) => {
        await tx.unsafe("CREATE TABLE garde_fou_temoin (id int, school_id uuid)");
        throw new Annulation(defauts(await tx.unsafe<TableEcole[]>(REQUETE_TABLES_ECOLE)));
      })
      .catch((e: unknown) => {
        if (e instanceof Annulation) return e.resultat;
        throw e;
      });

    // Seule la table témoin compte ici : un vrai défaut est signalé par le test précédent.
    expect(erreurs.filter((e) => e.startsWith("garde_fou_temoin "))).toEqual([
      "garde_fou_temoin : RLS non activée (ENABLE ROW LEVEL SECURITY), " +
        "RLS non forcée (FORCE ROW LEVEL SECURITY), politique school_isolation absente",
    ]);
  });

  it("détecte une politique school_isolation qui lit un autre réglage que app.school_id", async () => {
    // A policy with the right name but a stale setting (e.g. app.ecole_id after a rename) must be reported.
    const erreurs = await admin
      .begin(async (tx) => {
        await tx.unsafe(`
          CREATE TABLE garde_fou_reglage (id int, school_id uuid);
          ALTER TABLE garde_fou_reglage ENABLE ROW LEVEL SECURITY;
          ALTER TABLE garde_fou_reglage FORCE ROW LEVEL SECURITY;
          CREATE POLICY school_isolation ON garde_fou_reglage
            USING (school_id = NULLIF(current_setting('app.ecole_id', true), '')::uuid)
            WITH CHECK (school_id = NULLIF(current_setting('app.ecole_id', true), '')::uuid);
        `);
        throw new Annulation(defauts(await tx.unsafe<TableEcole[]>(REQUETE_TABLES_ECOLE)));
      })
      .catch((e: unknown) => {
        if (e instanceof Annulation) return e.resultat;
        throw e;
      });

    expect(erreurs.filter((e) => e.startsWith("garde_fou_reglage "))).toEqual([
      "garde_fou_reglage : school_isolation ne compare pas school_id au réglage app.school_id",
    ]);
  });
});
