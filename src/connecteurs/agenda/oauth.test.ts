import { describe, expect, it } from "vitest";
import {
  AccesRetire,
  defiPkce,
  echangerCode,
  identifiants,
  lirePlagesOccupees,
  plagesGoogle,
  plagesMicrosoft,
  rafraichir,
  signerEtat,
  urlAutorisation,
  verifierEtat,
} from "./oauth";

const id = { identifiant: "client", secret: "secret" };
const reponse = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
const jwt = (charge: object) => `x.${Buffer.from(JSON.stringify(charge)).toString("base64url")}.y`;

describe("configuration", () => {
  it("ne propose un fournisseur que s’il est configuré", () => {
    expect(identifiants("google", { GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toEqual({ identifiant: "a", secret: "b" });
    expect(identifiants("microsoft", { MICROSOFT_CLIENT_ID: "a" })).toBeNull();
  });

  it("construit l’adresse d’autorisation avec PKCE et des portées minimales", () => {
    const { defi } = defiPkce();
    const url = new URL(urlAutorisation("google", "client", { redirection: "https://app.test/retour", etat: "e", defi }));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/calendar.freebusy");
    expect(url.searchParams.get("access_type")).toBe("offline");
    const ms = new URL(urlAutorisation("microsoft", "client", { redirection: "https://app.test/retour", etat: "e", defi }));
    expect(ms.searchParams.get("scope")).toBe("openid email offline_access Calendars.ReadBasic");
  });
});

describe("état signé", () => {
  const e = { ecoleId: "e1", intervenantId: "i1", fournisseur: "google" as const, nonce: "n" };

  it("vérifie un état valide, refuse un état modifié, signé autrement ou expiré", () => {
    const etat = signerEtat(e, "s", 1_000);
    expect(verifierEtat(etat, "s", 2_000)).toMatchObject(e);
    expect(verifierEtat(etat, "autre", 2_000)).toBeNull();
    expect(verifierEtat(etat, "s", 1_000 + 11 * 60_000)).toBeNull();
    const [charge, sig] = etat.split(".");
    const falsifie = Buffer.from(JSON.stringify({ ...e, intervenantId: "i2", expire: 9e15 })).toString("base64url");
    expect(verifierEtat(`${falsifie}.${sig}`, "s", 2_000)).toBeNull();
    expect(verifierEtat(`${charge}`, "s", 2_000)).toBeNull();
  });
});

describe("jetons", () => {
  it("échange le code contre un accès durable et lit le compte", async () => {
    let corps = "";
    const r = await echangerCode("google", id, { code: "c", verificateur: "v", redirection: "https://app.test/retour" }, async (_u, init) => {
      corps = String(init?.body);
      return reponse(200, { access_token: "a", refresh_token: "r", id_token: jwt({ email: "camille@exemple.test" }) });
    });
    expect(r).toEqual({ jetonRafraichissement: "r", compte: "camille@exemple.test" });
    expect(corps).toContain("code_verifier=v");
    expect(corps).toContain("grant_type=authorization_code");
  });

  it("signale un accès retiré (invalid_grant)", async () => {
    await expect(rafraichir("microsoft", id, "r", async () => reponse(400, { error: "invalid_grant" }))).rejects.toBeInstanceOf(AccesRetire);
  });

  it("garde le nouveau jeton de rafraîchissement donné par Microsoft", async () => {
    expect(await rafraichir("microsoft", id, "r", async () => reponse(200, { access_token: "a", refresh_token: "r2" }))).toEqual({
      acces: "a",
      nouveauRafraichissement: "r2",
    });
  });
});

describe("plages occupées", () => {
  it("lit la réponse free/busy de Google", () => {
    expect(
      plagesGoogle({ calendars: { primary: { busy: [{ start: "2026-11-04T15:00:00Z", end: "2026-11-04T17:00:00Z" }] } } }),
    ).toEqual([{ debut: new Date("2026-11-04T15:00:00Z"), fin: new Date("2026-11-04T17:00:00Z") }]);
    expect(plagesGoogle({})).toEqual([]);
  });

  it("garde les événements Microsoft occupés et non annulés, en UTC", () => {
    const json = {
      value: [
        { start: { dateTime: "2026-11-04T15:00:00.0000000" }, end: { dateTime: "2026-11-04T17:00:00.0000000" }, showAs: "busy" },
        { start: { dateTime: "2026-11-05T15:00:00.0000000" }, end: { dateTime: "2026-11-05T17:00:00.0000000" }, showAs: "free" },
        { start: { dateTime: "2026-11-06T15:00:00.0000000" }, end: { dateTime: "2026-11-06T17:00:00.0000000" }, showAs: "oof", isCancelled: true },
        { start: { dateTime: "2026-11-07T08:00:00.0000000" }, end: { dateTime: "2026-11-07T09:00:00.0000000" }, showAs: "tentative" },
      ],
    };
    expect(plagesMicrosoft(json).map((p) => p.debut.toISOString())).toEqual(["2026-11-04T15:00:00.000Z", "2026-11-07T08:00:00.000Z"]);
  });

  it("suit les pages de Microsoft et envoie le jeton d’accès", async () => {
    const appels: string[] = [];
    const ev = (jour: string) => ({ start: { dateTime: `2026-11-${jour}T10:00:00` }, end: { dateTime: `2026-11-${jour}T11:00:00` }, showAs: "busy" });
    const plages = await lirePlagesOccupees(
      "microsoft",
      "acces",
      { debut: new Date("2026-11-01T00:00:00Z"), fin: new Date("2026-12-01T00:00:00Z") },
      async (url, init) => {
        appels.push(`${url} ${(init?.headers as Record<string, string>).Authorization}`);
        return appels.length === 1 ? reponse(200, { value: [ev("04")], "@odata.nextLink": "https://graph.test/page2" }) : reponse(200, { value: [ev("05")] });
      },
    );
    expect(plages).toHaveLength(2);
    expect(appels[1]).toBe("https://graph.test/page2 Bearer acces");
  });
});
