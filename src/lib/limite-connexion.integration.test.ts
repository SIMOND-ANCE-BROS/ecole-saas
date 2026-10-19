import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { auth } from "./auth";
import { cleDeTentative, connexionBloquee, effacerEchecs, LIMITES, noterEchec } from "./limite-connexion";

/** Limitation des tentatives de connexion, contre la vraie base (données fictives nettoyées). */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
const email = (n: string) => `${n}-${suffixe}@exemple.test`;
const ip = (n: number) => `203.0.113.${n}`;
const cles: string[] = [];

async function echecs(adresse: string, depuis: string, n: number) {
  for (let i = 0; i < n; i++) await noterEchec(adresse, depuis);
  cles.push(cleDeTentative("email", adresse), cleDeTentative("ip", depuis));
}

afterAll(async () => {
  await admin`DELETE FROM tentative_connexion WHERE cle IN ${admin(cles)}`;
  await admin.end();
});

describe("Limitation des tentatives de connexion", () => {
  it("bloque une adresse e-mail après trop d’échecs, sans toucher les autres", async () => {
    await echecs(email("cible"), ip(1), LIMITES.parEmail - 1);
    expect(await connexionBloquee(email("cible"), ip(2))).toBe(false);
    await echecs(email("cible"), ip(1), 1);
    expect(await connexionBloquee(email("cible"), ip(2))).toBe(true);
    expect(await connexionBloquee(email("autre"), ip(2))).toBe(false);
  });

  it("bloque une adresse IP qui essaie beaucoup d’adresses e-mail", async () => {
    for (let i = 0; i < LIMITES.parIp; i++) await echecs(email(`balayage-${i}`), ip(3), 1);
    expect(await connexionBloquee(email("nouvelle"), ip(3))).toBe(true);
    expect(await connexionBloquee(email("nouvelle"), ip(4))).toBe(false);
  });

  it("efface les échecs d’une adresse après une connexion réussie", async () => {
    await echecs(email("oubli"), ip(5), LIMITES.parEmail);
    expect(await connexionBloquee(email("oubli"), ip(6))).toBe(true);
    await effacerEchecs(email("oubli"));
    expect(await connexionBloquee(email("oubli"), ip(6))).toBe(false);
  });

  it("ne compte plus les tentatives sorties de la fenêtre", async () => {
    await echecs(email("ancienne"), ip(7), LIMITES.parEmail);
    await admin`
      UPDATE tentative_connexion SET quand = now() - make_interval(mins => ${LIMITES.fenetreMinutes + 1})
      WHERE cle = ${cleDeTentative("email", email("ancienne"))}`;
    expect(await connexionBloquee(email("ancienne"), ip(8))).toBe(false);
  });

  it("ne stocke ni l’adresse e-mail ni l’IP en clair", async () => {
    const lignes = await admin`SELECT cle FROM tentative_connexion WHERE cle = ${cleDeTentative("email", email("cible"))}`;
    expect(lignes.length).toBeGreaterThan(0);
    expect(lignes[0].cle).not.toContain("@");
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
