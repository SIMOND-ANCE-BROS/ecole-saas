import { createHmac } from "node:crypto";
import { and, count, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { tentativeConnexion } from "../db/schema";

/**
 * Limitation des essais de mots de passe : au-delà de `parEmail` échecs sur une
 * même adresse, ou `parIp` échecs depuis une même IP, dans la fenêtre, la
 * connexion est refusée sans même vérifier le mot de passe. Stockage en base
 * (partagé entre instances), clés hachées (HMAC du secret de l'application).
 */
export const LIMITES = { parEmail: 5, parIp: 30, fenetreMinutes: 15 } as const;

export function cleDeTentative(type: "email" | "ip", valeur: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET manquant");
  return createHmac("sha256", secret).update(`${type}:${valeur.trim().toLowerCase()}`).digest("hex");
}

const depuisFenetre = sql`now() - make_interval(mins => ${LIMITES.fenetreMinutes})`;

async function echecsRecents(cle: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(tentativeConnexion)
    .where(and(eq(tentativeConnexion.cle, cle), gt(tentativeConnexion.quand, depuisFenetre)));
  return n;
}

export async function connexionBloquee(email: string, ip: string): Promise<boolean> {
  const [parEmail, parIp] = await Promise.all([
    echecsRecents(cleDeTentative("email", email)),
    echecsRecents(cleDeTentative("ip", ip)),
  ]);
  return parEmail >= LIMITES.parEmail || parIp >= LIMITES.parIp;
}

export async function noterEchec(email: string, ip: string): Promise<void> {
  await db.insert(tentativeConnexion).values([
    { cle: cleDeTentative("email", email) },
    { cle: cleDeTentative("ip", ip) },
  ]);
  // Purge au fil de l'eau : rien n'est gardé au-delà d'une journée.
  await db.delete(tentativeConnexion).where(lt(tentativeConnexion.quand, sql`now() - interval '1 day'`));
}

/** Après une connexion réussie : les échecs de cette adresse ne comptent plus (ceux de l'IP restent). */
export async function effacerEchecs(email: string): Promise<void> {
  await db.delete(tentativeConnexion).where(eq(tentativeConnexion.cle, cleDeTentative("email", email)));
}
