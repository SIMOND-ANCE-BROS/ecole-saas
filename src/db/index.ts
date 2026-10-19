import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/** Connexion avec le rôle `app_user`, soumis à la Row Level Security. */
const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Exécute `fn` dans une transaction limitée à une école.
 * Toute requête faite avec `tx` ne voit et n'écrit que les lignes de cette école.
 */
export function avecEcole<T>(ecoleId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.ecole_id', ${ecoleId}, true)`);
    return fn(tx);
  });
}

/**
 * Liste les écoles où un utilisateur est membre actif, à la connexion (avant
 * d'en choisir une). Un membre désactivé n'y a plus accès.
 */
export function ecolesDe(userId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return tx
      .select({ id: schema.ecole.id, nom: schema.ecole.nom, role: schema.membre.role })
      .from(schema.membre)
      .innerJoin(schema.ecole, sql`${schema.ecole.id} = ${schema.membre.ecoleId}`)
      .where(eq(schema.membre.actif, true))
      .orderBy(schema.ecole.nom);
  });
}
