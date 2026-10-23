import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { auth } from "./auth";
import { attemptKey, clearAttempts, recordAttempt, trustedIp, LIMITES } from "./sign-in-limit";

/** Sign-in attempt limiting, against the real database (fictitious data cleaned up). */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const email = (n: string) => `${n}-${suffix}@exemple.test`;
const ip = (n: number) => `203.0.113.${n}`;
const addresses: string[] = [];
const ips: string[] = [];

/** n attempts; returns the number of allowed attempts. */
async function tentatives(address: string, since: string | null, n: number) {
  addresses.push(address);
  if (since) ips.push(since);
  let allowed = 0;
  for (let i = 0; i < n; i++) if (await recordAttempt(address, since)) allowed++;
  return allowed;
}

afterAll(async () => {
  const keys = [
    ...addresses.flatMap((a) => [
      attemptKey("email", a),
      ...ips.map((i) => attemptKey("paire", `${a}|${i}`)),
      attemptKey("paire", `${a}|`),
    ]),
    ...ips.map((i) => attemptKey("ip", i)),
  ];
  await admin`DELETE FROM login_attempt WHERE key IN ${admin(keys)}`;
  await admin.end();
});

describe("Limitation des tentatives de connexion", () => {
  it("bloque une adresse e-mail depuis une même IP au-delà de la limite de la paire", async () => {
    expect(await tentatives(email("cible"), ip(1), LIMITES.byPair + 2)).toBe(LIMITES.byPair);
  });

  it("laisse la vraie personne se connecter depuis une autre IP (pas de blocage du compte d’autrui)", async () => {
    await tentatives(email("victime"), ip(2), LIMITES.byPair + 3);
    expect(await recordAttempt(email("victime"), ip(9))).toBe(true);
  });

  it("borne malgré tout le nombre total d’essais sur une même adresse", async () => {
    let allowed = 0;
    for (let i = 0; i < LIMITES.byEmail + 5; i++) allowed += await tentatives(email("globale"), ip(100 + (i % 50)), 1);
    expect(allowed).toBe(LIMITES.byEmail);
  });

  it("bloque une IP qui balaye beaucoup d’adresses", async () => {
    let allowed = 0;
    for (let i = 0; i < LIMITES.byIp + 3; i++) allowed += await tentatives(email(`balayage-${i}`), ip(3), 1);
    expect(allowed).toBe(LIMITES.byIp);
  });

  it("résiste aux tentatives simultanées", async () => {
    addresses.push(email("course"));
    ips.push(ip(4));
    const results = await Promise.all(Array.from({ length: 10 }, () => recordAttempt(email("course"), ip(4))));
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(LIMITES.byPair);
  });

  it("ne prolonge pas le blocage quand on s’acharne (les tentatives refusées ne comptent pas)", async () => {
    await tentatives(email("acharne"), ip(10), LIMITES.byPair + 20);
    const [{ n }] = await admin`
      SELECT count(*)::int AS n FROM login_attempt
      WHERE key = ${attemptKey("paire", `${email("acharne")}|${ip(10)}`)}`;
    expect(n).toBe(LIMITES.byPair);
  });

  it("efface les tentatives de l’adresse après une connexion réussie", async () => {
    await tentatives(email("oubli"), ip(5), LIMITES.byPair);
    expect(await recordAttempt(email("oubli"), ip(5))).toBe(false);
    await clearAttempts(email("oubli"), ip(5));
    expect(await recordAttempt(email("oubli"), ip(5))).toBe(true);
  });

  it("sans IP de confiance, applique la limite de la paire à l’adresse seule", async () => {
    expect(await tentatives(email("sans-ip"), null, LIMITES.byPair + 1)).toBe(LIMITES.byPair);
  });

  it("ne compte plus les tentatives sorties de la fenêtre", async () => {
    await tentatives(email("ancienne"), ip(7), LIMITES.byPair);
    await admin`
      UPDATE login_attempt SET at = now() - make_interval(mins => ${LIMITES.windowMinutes + 1})
      WHERE key IN (${attemptKey("email", email("ancienne"))}, ${attemptKey("paire", `${email("ancienne")}|${ip(7)}`)})`;
    expect(await recordAttempt(email("ancienne"), ip(7))).toBe(true);
  });

  it("ne stocke ni l’adresse e-mail ni l’IP en clair", async () => {
    const rows = await admin`SELECT key FROM login_attempt WHERE key = ${attemptKey("email", email("cible"))}`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].key).not.toContain("@");
  });
});

describe("IP du client", () => {
  const requestHeaders = new Headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "198.51.100.7" });

  it("ignore les en-têtes fournis par le client tant qu’aucun proxy de confiance n’est configuré", () => {
    expect(trustedIp(requestHeaders, undefined)).toBeNull();
  });

  it("lit uniquement l’en-tête posé par le proxy de confiance", () => {
    expect(trustedIp(requestHeaders, "x-real-ip")).toBe("198.51.100.7");
    expect(trustedIp(new Headers(), "x-real-ip")).toBeNull();
  });
});

describe("Porte d’entrée unique", () => {
  it("ferme la connexion par la route HTTP de Better Auth (seule la server action limitée reste)", async () => {
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email("http"), password: "peu-importe-le-mot-de-passe" }),
      }),
    );
    expect(response.status).toBe(404);
  });
});
