import { createHmac } from "node:crypto";
import { and, count, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { loginAttempt } from "../db/schema";

/**
 * Limiting password attempts, over a sliding window:
 * - `byPair` attempts for the same e-mail address from the same IP;
 * - `byEmail` attempts in total on an address (bounds distributed brute
 *   force, without making it easy to lock someone else's account);
 * - `byIp` attempts from the same IP (address sweeping).
 * Each attempt is recorded BEFORE being counted (no race between
 * simultaneous requests). Stored in the database, HMAC keys: nothing in clear.
 */
export const LIMITES = { byPair: 5, byEmail: 20, byIp: 30, windowMinutes: 15 } as const;

type KeyType = "email" | "paire" | "ip";

export function attemptKey(type: KeyType, value: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET manquant");
  return createHmac("sha256", secret).update(`${type}:${value.trim().toLowerCase()}`).digest("hex");
}

/**
 * Client IP, read ONLY from the header set by our own proxy
 * (IP_CLIENT_EN_TETE, e.g. "x-real-ip"): a header supplied by the client
 * (x-forwarded-for…) can be forged. Without configuration: null, and the
 * per-IP limit does not apply.
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
 * Records an attempt then checks the limits, new attempt included. Returns
 * false if sign-in must be refused without checking the password; the
 * refused attempt is then removed, so that persisting does not extend the
 * lock (it expires after the last accepted attempt).
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
  // Ongoing purge: nothing is kept beyond one day.
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

/** After a successful sign-in: the address and the pair start again from zero (not the IP). */
export async function clearAttempts(email: string, ip: string | null): Promise<void> {
  const [pair, address] = keys(email, ip);
  await db.delete(loginAttempt).where(inArray(loginAttempt.key, [pair.key, address.key]));
}
