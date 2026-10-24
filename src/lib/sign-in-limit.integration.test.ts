import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { auth } from "./auth";
import { attemptKey, clearAttempts, recordAttempt, trustedIp, LIMITS } from "./sign-in-limit";

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

describe("Sign-in attempt limiting", () => {
  it("blocks an e-mail address from the same IP beyond the pair limit", async () => {
    expect(await tentatives(email("cible"), ip(1), LIMITS.byPair + 2)).toBe(LIMITS.byPair);
  });

  it("lets the real person sign in from another IP (no locking out someone else's account)", async () => {
    await tentatives(email("victime"), ip(2), LIMITS.byPair + 3);
    expect(await recordAttempt(email("victime"), ip(9))).toBe(true);
  });

  it("still caps the total number of attempts on the same address", async () => {
    let allowed = 0;
    for (let i = 0; i < LIMITS.byEmail + 5; i++) allowed += await tentatives(email("globale"), ip(100 + (i % 50)), 1);
    expect(allowed).toBe(LIMITS.byEmail);
  });

  it("blocks an IP that sweeps many addresses", async () => {
    let allowed = 0;
    for (let i = 0; i < LIMITS.byIp + 3; i++) allowed += await tentatives(email(`balayage-${i}`), ip(3), 1);
    expect(allowed).toBe(LIMITS.byIp);
  });

  it("withstands concurrent attempts", async () => {
    addresses.push(email("course"));
    ips.push(ip(4));
    const results = await Promise.all(Array.from({ length: 10 }, () => recordAttempt(email("course"), ip(4))));
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(LIMITS.byPair);
  });

  it("does not extend the block on persistent retries (refused attempts do not count)", async () => {
    await tentatives(email("acharne"), ip(10), LIMITS.byPair + 20);
    const [{ n }] = await admin`
      SELECT count(*)::int AS n FROM login_attempt
      WHERE key = ${attemptKey("paire", `${email("acharne")}|${ip(10)}`)}`;
    expect(n).toBe(LIMITS.byPair);
  });

  it("clears the address's attempts after a successful sign-in", async () => {
    await tentatives(email("oubli"), ip(5), LIMITS.byPair);
    expect(await recordAttempt(email("oubli"), ip(5))).toBe(false);
    await clearAttempts(email("oubli"), ip(5));
    expect(await recordAttempt(email("oubli"), ip(5))).toBe(true);
  });

  it("without a trusted IP, applies the pair limit to the address alone", async () => {
    expect(await tentatives(email("sans-ip"), null, LIMITS.byPair + 1)).toBe(LIMITS.byPair);
  });

  it("stops counting attempts outside the window", async () => {
    await tentatives(email("ancienne"), ip(7), LIMITS.byPair);
    await admin`
      UPDATE login_attempt SET at = now() - make_interval(mins => ${LIMITS.windowMinutes + 1})
      WHERE key IN (${attemptKey("email", email("ancienne"))}, ${attemptKey("paire", `${email("ancienne")}|${ip(7)}`)})`;
    expect(await recordAttempt(email("ancienne"), ip(7))).toBe(true);
  });

  it("stores neither the e-mail address nor the IP in clear", async () => {
    const rows = await admin`SELECT key FROM login_attempt WHERE key = ${attemptKey("email", email("cible"))}`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].key).not.toContain("@");
  });
});

describe("Client IP", () => {
  const requestHeaders = new Headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "198.51.100.7" });

  it("ignores client-supplied headers as long as no trusted proxy is configured", () => {
    expect(trustedIp(requestHeaders, undefined)).toBeNull();
  });

  it("reads only the header set by the trusted proxy", () => {
    expect(trustedIp(requestHeaders, "x-real-ip")).toBe("198.51.100.7");
    expect(trustedIp(new Headers(), "x-real-ip")).toBeNull();
  });
});

describe("Single entry point", () => {
  it("closes sign-in through the Better Auth HTTP route (only the rate-limited server action remains)", async () => {
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
