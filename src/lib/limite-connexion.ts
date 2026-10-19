import { createHmac } from "node:crypto";
import { and, count, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { tentativeConnexion } from "../db/schema";

/**
 * Limitation des essais de mots de passe, sur une fenêtre glissante :
 * - `parPaire` tentatives pour une même adresse e-mail depuis une même IP ;
 * - `parEmail` tentatives au total sur une adresse (borne le brute force
 *   distribué, sans permettre de bloquer facilement le compte d'autrui) ;
 * - `parIp` tentatives depuis une même IP (balayage d'adresses).
 * Chaque tentative est enregistrée AVANT d'être comptée (pas de course entre
 * requêtes simultanées). Stockage en base, clés HMAC : rien en clair.
 */
export const LIMITES = { parPaire: 5, parEmail: 20, parIp: 30, fenetreMinutes: 15 } as const;

type TypeCle = "email" | "paire" | "ip";

export function cleDeTentative(type: TypeCle, valeur: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET manquant");
  return createHmac("sha256", secret).update(`${type}:${valeur.trim().toLowerCase()}`).digest("hex");
}

/**
 * IP du client, lue SEULEMENT dans l'en-tête posé par notre propre proxy
 * (IP_CLIENT_EN_TETE, ex. « x-real-ip ») : un en-tête fourni par le client
 * (x-forwarded-for…) est falsifiable. Sans configuration : null, et la limite
 * par IP ne s'applique pas.
 */
export function ipDeConfiance(entetes: Headers, enTete = process.env.IP_CLIENT_EN_TETE): string | null {
  if (!enTete) return null;
  return entetes.get(enTete)?.trim() || null;
}

function cles(email: string, ip: string | null) {
  const limites: { cle: string; max: number }[] = [
    { cle: cleDeTentative("paire", `${email}|${ip ?? ""}`), max: LIMITES.parPaire },
    { cle: cleDeTentative("email", email), max: LIMITES.parEmail },
  ];
  if (ip) limites.push({ cle: cleDeTentative("ip", ip), max: LIMITES.parIp });
  return limites;
}

/**
 * Enregistre une tentative puis vérifie les limites, nouvelle tentative
 * comprise. Renvoie false si la connexion doit être refusée sans vérifier le
 * mot de passe.
 */
export async function enregistrerTentative(email: string, ip: string | null): Promise<boolean> {
  const limites = cles(email, ip);
  await db.insert(tentativeConnexion).values(limites.map(({ cle }) => ({ cle })));
  const comptes = await db
    .select({ cle: tentativeConnexion.cle, n: count() })
    .from(tentativeConnexion)
    .where(
      and(
        inArray(
          tentativeConnexion.cle,
          limites.map((l) => l.cle),
        ),
        gt(tentativeConnexion.quand, sql`now() - make_interval(mins => ${LIMITES.fenetreMinutes})`),
      ),
    )
    .groupBy(tentativeConnexion.cle);
  // Purge au fil de l'eau : rien n'est gardé au-delà d'une journée.
  await db.delete(tentativeConnexion).where(lt(tentativeConnexion.quand, sql`now() - interval '1 day'`));
  return limites.every(({ cle, max }) => (comptes.find((c) => c.cle === cle)?.n ?? 0) <= max);
}

/** Après une connexion réussie : l'adresse et la paire repartent de zéro (pas l'IP). */
export async function effacerTentatives(email: string, ip: string | null): Promise<void> {
  const [paire, adresse] = cles(email, ip);
  await db.delete(tentativeConnexion).where(inArray(tentativeConnexion.cle, [paire.cle, adresse.cle]));
}
