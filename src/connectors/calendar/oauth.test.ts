import { describe, expect, it } from "vitest";
import {
  AccessRemoved,
  pkceChallenge,
  exchangeCode,
  credentials,
  readBusyRanges,
  googleRanges,
  microsoftRanges,
  refresh,
  signState,
  authorizationUrl,
  verifyState,
} from "./oauth";

const id = { identifier: "client", secret: "secret" };
const response = (status: number, json: unknown) =>
  new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
const jwt = (load: object) => `x.${Buffer.from(JSON.stringify(load)).toString("base64url")}.y`;

describe("configuration", () => {
  it("offers a provider only when it is configured", () => {
    expect(credentials("google", { GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toEqual({
      identifier: "a",
      secret: "b",
    });
    expect(credentials("microsoft", { MICROSOFT_CLIENT_ID: "a" })).toBeNull();
  });

  it("builds the authorization URL with PKCE and minimal scopes", () => {
    const { challenge: challenge } = pkceChallenge();
    const url = new URL(
      authorizationUrl("google", "client", {
        redirectUri: "https://app.test/retour",
        state: "e",
        challenge: challenge,
      }),
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/calendar.freebusy");
    expect(url.searchParams.get("access_type")).toBe("offline");
    const ms = new URL(
      authorizationUrl("microsoft", "client", {
        redirectUri: "https://app.test/retour",
        state: "e",
        challenge: challenge,
      }),
    );
    expect(ms.searchParams.get("scope")).toBe("openid email offline_access Calendars.ReadBasic");
  });
});

describe("signed state", () => {
  const e = { schoolId: "e1", instructorId: "i1", provider: "google" as const, nonce: "n" };

  it("accepts a valid state, rejects a tampered, differently signed or expired one", () => {
    const state = signState(e, "s", 1_000);
    expect(verifyState(state, "s", 2_000)).toMatchObject(e);
    expect(verifyState(state, "autre", 2_000)).toBeNull();
    expect(verifyState(state, "s", 1_000 + 11 * 60_000)).toBeNull();
    const [load, sig] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ ...e, instructorId: "i2", expiresAt: 9e15 })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, "s", 2_000)).toBeNull();
    expect(verifyState(`${load}`, "s", 2_000)).toBeNull();
  });
});

describe("tokens", () => {
  it("exchanges the code for lasting access and reads the account", async () => {
    let body = "";
    const r = await exchangeCode(
      "google",
      id,
      { code: "c", verifier: "v", redirectUri: "https://app.test/retour" },
      async (_u, init) => {
        body = String(init?.body);
        return response(200, {
          access_token: "a",
          refresh_token: "r",
          id_token: jwt({ email: "camille@exemple.test" }),
        });
      },
    );
    expect(r).toEqual({ refreshToken: "r", account: "camille@exemple.test" });
    expect(body).toContain("code_verifier=v");
    expect(body).toContain("grant_type=authorization_code");
  });

  it("reports revoked access (invalid_grant)", async () => {
    await expect(
      refresh("microsoft", id, "r", async () => response(400, { error: "invalid_grant" })),
    ).rejects.toBeInstanceOf(AccessRemoved);
  });

  it("keeps the new refresh token given by Microsoft", async () => {
    expect(
      await refresh("microsoft", id, "r", async () => response(200, { access_token: "a", refresh_token: "r2" })),
    ).toEqual({
      access: "a",
      newRefreshToken: "r2",
    });
  });
});

describe("busy ranges", () => {
  it("reads Google's free/busy response", () => {
    expect(
      googleRanges({
        calendars: { primary: { busy: [{ start: "2026-11-04T15:00:00Z", end: "2026-11-04T17:00:00Z" }] } },
      }),
    ).toEqual([{ start: new Date("2026-11-04T15:00:00Z"), end: new Date("2026-11-04T17:00:00Z") }]);
    expect(googleRanges({})).toEqual([]);
  });

  it("keeps busy, non-cancelled Microsoft events, in UTC", () => {
    const json = {
      value: [
        {
          start: { dateTime: "2026-11-04T15:00:00.0000000" },
          end: { dateTime: "2026-11-04T17:00:00.0000000" },
          showAs: "busy",
        },
        {
          start: { dateTime: "2026-11-05T15:00:00.0000000" },
          end: { dateTime: "2026-11-05T17:00:00.0000000" },
          showAs: "free",
        },
        {
          start: { dateTime: "2026-11-06T15:00:00.0000000" },
          end: { dateTime: "2026-11-06T17:00:00.0000000" },
          showAs: "oof",
          isCancelled: true,
        },
        {
          start: { dateTime: "2026-11-07T08:00:00.0000000" },
          end: { dateTime: "2026-11-07T09:00:00.0000000" },
          showAs: "tentative",
        },
      ],
    };
    expect(microsoftRanges(json).map((p) => p.start.toISOString())).toEqual([
      "2026-11-04T15:00:00.000Z",
      "2026-11-07T08:00:00.000Z",
    ]);
  });

  it("follows Microsoft's pages and sends the access token", async () => {
    const attendances: string[] = [];
    const ev = (day: string) => ({
      start: { dateTime: `2026-11-${day}T10:00:00` },
      end: { dateTime: `2026-11-${day}T11:00:00` },
      showAs: "busy",
    });
    const ranges = await readBusyRanges(
      "microsoft",
      "acces",
      { start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-12-01T00:00:00Z") },
      async (url, init) => {
        attendances.push(`${url} ${(init?.headers as Record<string, string>).Authorization}`);
        return attendances.length === 1
          ? response(200, { value: [ev("04")], "@odata.nextLink": "https://graph.test/page2" })
          : response(200, { value: [ev("05")] });
      },
    );
    expect(ranges).toHaveLength(2);
    expect(attendances[1]).toBe("https://graph.test/page2 Bearer acces");
  });
});
