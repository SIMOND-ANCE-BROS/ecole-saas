import { createHmac } from "node:crypto";
import { and, count, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { loginAttempt } from "../db/schema";

/**
 * Limitation des essais de mots de passe, sur une fenêtre glissante :
 * - `parPaire` tentatives pour une même adresse e-mail depuis une même IP ;
 * - `parEmail` tentatives au total sur une adresse (borne le brute force
 *   distribué, sans permettre de bloquer facilement le compte d'autrui) ;
 * - `parIp` tentatives depuis une même IP (balayage d'adresses).
 * Chaque tentative est enregistrée AVANT d'être comptée (pas de course entre
 * requêtes simultanées). Stockage en base, clés HMAC : rien en clair.
 */
export const LIMITES = { byPair: 5, byEmail: 20, byIp: 30, windowMinutes: 15 } as const;

type KeyType = "email" | "paire" | "ip";

export function attemptKey(type: KeyType, value: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET manquant");
  return createHmac("sha256", secret).update(`${type}:${value.trim().toLowerCase()}`).digest("hex");
}

/**
 * IP du client, lue SEULEMENT dans l'en-tête posé par notre propre proxy
 * (IP_CLIENT_EN_TETE, ex. « x-real-ip ») : un en-tête fourni par le client
 * (x-forwarded-for…) est falsifiable. Sans configuration : null, et la limite
 * par IP ne s'applique pas.
 */
export function trustedIp(requestHeaders: Headers, headerName = process.env.IP_CLIENT_EN_TETE): string | null {
  if (!headerName) return null;
  return requestHeaders.get(headerName)?.trim() || null;
}

function keys(email: string, ip: string | null) {
  const limites: { key: string; max: number }[] = [
    { key: attemptKey("paire", `${email}|${ip ?? ""}`), max: LIMITES.byPair },
    { key: attemptKey("email", email), max: LIMITES.byEmail },
  ];
  if (ip) limites.push({ key: attemptKey("ip", ip), max: LIMITES.byIp });
  return limites;
}

/**
 * Enregistre une tentative puis vérifie les limites, nouvelle tentative
 * comprise. Renvoie false si la connexion doit être refusée sans vérifier le
 * mot de passe ; la tentative refusée est alors retirée, pour que s'acharner
 * ne prolonge pas le blocage (il expire après la dernière tentative acceptée).
 */
export async function recordAttempt(email: string, ip: string | null): Promise<boolean> {
  const limites = keys(email, ip);
  const inserted = await db
    .insert(loginAttempt)
    .values(limites.map(({ key: key }) => ({ key: key })))
    .returning({ id: loginAttempt.id });
  const accounts = await db
    .select({ key: loginAttempt.key, n: count() })
    .from(loginAttempt)
    .where(
      and(
        inArray(
          loginAttempt.key,
          limites.map((l) => l.key),
        ),
        gt(loginAttempt.at, sql`now() - make_interval(mins => ${LIMITES.windowMinutes})`),
      ),
    )
    .groupBy(loginAttempt.key);
  // Purge au fil de l'eau : rien n'est gardé au-delà d'une journée.
  await db.delete(loginAttempt).where(lt(loginAttempt.at, sql`now() - interval '1 day'`));
  const allowed = limites.every(({ key: key, max }) => (accounts.find((c) => c.key === key)?.n ?? 0) <= max);
  if (!allowed) {
    await db.delete(loginAttempt).where(
      inArray(
        loginAttempt.id,
        inserted.map((l) => l.id),
      ),
    );
  }
  return allowed;
}

/** Après une connexion réussie : l'adresse et la paire repartent de zéro (pas l'IP). */
export async function clearAttempts(email: string, ip: string | null): Promise<void> {
  const [pair, address] = keys(email, ip);
  await db.delete(loginAttempt).where(inArray(loginAttempt.key, [pair.key, address.key]));
}
