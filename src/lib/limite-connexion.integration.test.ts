import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { auth } from "./auth";
import { cleDeTentative, effacerTentatives, enregistrerTentative, ipDeConfiance, LIMITES } from "./limite-connexion";

/** Limitation des tentatives de connexion, contre la vraie base (données fictives nettoyées). */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
const email = (n: string) => `${n}-${suffixe}@exemple.test`;
const ip = (n: number) => `203.0.113.${n}`;
const adresses: string[] = [];
const ips: string[] = [];

/** n tentatives ; renvoie le nombre de tentatives autorisées. */
async function tentatives(adresse: string, depuis: string | null, n: number) {
  adresses.push(adresse);
  if (depuis) ips.push(depuis);
  let autorisees = 0;
  for (let i = 0; i < n; i++) if (await enregistrerTentative(adresse, depuis)) autorisees++;
  return autorisees;
}

afterAll(async () => {
  const cles = [
    ...adresses.flatMap((a) => [
      cleDeTentative("email", a),
      ...ips.map((i) => cleDeTentative("paire", `${a}|${i}`)),
      cleDeTentative("paire", `${a}|`),
    ]),
    ...ips.map((i) => cleDeTentative("ip", i)),
  ];
  await admin`DELETE FROM login_attempt WHERE key IN ${admin(cles)}`;
  await admin.end();
});

describe("Limitation des tentatives de connexion", () => {
  it("bloque une adresse e-mail depuis une même IP au-delà de la limite de la paire", async () => {
    expect(await tentatives(email("cible"), ip(1), LIMITES.parPaire + 2)).toBe(LIMITES.parPaire);
  });

  it("laisse la vraie personne se connecter depuis une autre IP (pas de blocage du compte d’autrui)", async () => {
    await tentatives(email("victime"), ip(2), LIMITES.parPaire + 3);
    expect(await enregistrerTentative(email("victime"), ip(9))).toBe(true);
  });

  it("borne malgré tout le nombre total d’essais sur une même adresse", async () => {
    let autorisees = 0;
    for (let i = 0; i < LIMITES.parEmail + 5; i++)
      autorisees += await tentatives(email("globale"), ip(100 + (i % 50)), 1);
    expect(autorisees).toBe(LIMITES.parEmail);
  });

  it("bloque une IP qui balaye beaucoup d’adresses", async () => {
    let autorisees = 0;
    for (let i = 0; i < LIMITES.parIp + 3; i++) autorisees += await tentatives(email(`balayage-${i}`), ip(3), 1);
    expect(autorisees).toBe(LIMITES.parIp);
  });

  it("résiste aux tentatives simultanées", async () => {
    adresses.push(email("course"));
    ips.push(ip(4));
    const resultats = await Promise.all(Array.from({ length: 10 }, () => enregistrerTentative(email("course"), ip(4))));
    expect(resultats.filter(Boolean).length).toBeLessThanOrEqual(LIMITES.parPaire);
  });

  it("ne prolonge pas le blocage quand on s’acharne (les tentatives refusées ne comptent pas)", async () => {
    await tentatives(email("acharne"), ip(10), LIMITES.parPaire + 20);
    const [{ n }] = await admin`
      SELECT count(*)::int AS n FROM login_attempt
      WHERE key = ${cleDeTentative("paire", `${email("acharne")}|${ip(10)}`)}`;
    expect(n).toBe(LIMITES.parPaire);
  });

  it("efface les tentatives de l’adresse après une connexion réussie", async () => {
    await tentatives(email("oubli"), ip(5), LIMITES.parPaire);
    expect(await enregistrerTentative(email("oubli"), ip(5))).toBe(false);
    await effacerTentatives(email("oubli"), ip(5));
    expect(await enregistrerTentative(email("oubli"), ip(5))).toBe(true);
  });

  it("sans IP de confiance, applique la limite de la paire à l’adresse seule", async () => {
    expect(await tentatives(email("sans-ip"), null, LIMITES.parPaire + 1)).toBe(LIMITES.parPaire);
  });

  it("ne compte plus les tentatives sorties de la fenêtre", async () => {
    await tentatives(email("ancienne"), ip(7), LIMITES.parPaire);
    await admin`
      UPDATE login_attempt SET at = now() - make_interval(mins => ${LIMITES.fenetreMinutes + 1})
      WHERE key IN (${cleDeTentative("email", email("ancienne"))}, ${cleDeTentative("paire", `${email("ancienne")}|${ip(7)}`)})`;
    expect(await enregistrerTentative(email("ancienne"), ip(7))).toBe(true);
  });

  it("ne stocke ni l’adresse e-mail ni l’IP en clair", async () => {
    const lignes = await admin`SELECT key FROM login_attempt WHERE key = ${cleDeTentative("email", email("cible"))}`;
    expect(lignes.length).toBeGreaterThan(0);
    expect(lignes[0].key).not.toContain("@");
  });
});

describe("IP du client", () => {
  const entetes = new Headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "198.51.100.7" });

  it("ignore les en-têtes fournis par le client tant qu’aucun proxy de confiance n’est configuré", () => {
    expect(ipDeConfiance(entetes, undefined)).toBeNull();
  });

  it("lit uniquement l’en-tête posé par le proxy de confiance", () => {
    expect(ipDeConfiance(entetes, "x-real-ip")).toBe("198.51.100.7");
    expect(ipDeConfiance(new Headers(), "x-real-ip")).toBeNull();
  });
});

describe("Porte d’entrée unique", () => {
  it("ferme la connexion par la route HTTP de Better Auth (seule la server action limitée reste)", async () => {
    const reponse = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email("http"), password: "peu-importe-le-mot-de-passe" }),
      }),
    );
    expect(reponse.status).toBe(404);
  });
});
