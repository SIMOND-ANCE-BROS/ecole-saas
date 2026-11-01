import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

/**
 * Return from Google or Microsoft (#377): once the connection is saved, a first sync that throws
 * must not answer 500. The provider, the database and the sync are stubbed.
 */
const SCHOOL = "5b0c1d2e-0000-4000-8000-000000000001";
const INSTRUCTOR = "5b0c1d2e-0000-4000-8000-000000000002";

vi.mock("@/connectors/calendar/oauth", () => ({
  PROVIDERS: ["google", "microsoft"],
  credentials: () => ({ identifier: "client-test", secret: "secret-test" }),
  verifyState: () => ({
    schoolId: "5b0c1d2e-0000-4000-8000-000000000001",
    instructorId: "5b0c1d2e-0000-4000-8000-000000000002",
    provider: "microsoft",
    nonce: "nonce-test",
    expiresAt: Number.MAX_SAFE_INTEGER,
  }),
  exchangeCode: async () => ({ refreshToken: "zz-refresh-token", account: "zz@example.test" }),
}));
vi.mock("@/db", () => ({ withSchool: async () => true }));
vi.mock("@/db/calendar-connections", () => ({ saveConnection: vi.fn() }));
vi.mock("@/lib/encryption", () => ({ encrypt: (s: string) => `chiffre:${s}` }));
// Vitest has no `@/` alias: the real modules, by relative path.
vi.mock("@/lib/public-calendar", () => import("../../../../../lib/public-calendar"));
const syncCalendar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/calendar-sync", async () => ({
  ...(await import("../../../../../lib/calendar-sync")),
  syncCalendar,
}));

const { GET } = await import("./route");

const cookie = Buffer.from(
  JSON.stringify({ verifier: "verifier-test", nonce: "nonce-test", back: `/mon-agenda/${SCHOOL}/jeton` }),
).toString("base64url");
const callBack = () =>
  GET(
    new NextRequest("http://localhost/api/agenda/retour/microsoft?code=code-test&state=etat-test", {
      headers: { cookie: `agenda_oauth=${cookie}` },
    }),
    { params: Promise.resolve({ fournisseur: "microsoft" }) },
  );

let logged: MockInstance<typeof console.error>;
beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", "https://ecole.example.test");
  syncCalendar.mockReset();
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  logged.mockRestore();
  vi.unstubAllEnvs();
});

describe("GET /api/agenda/retour/[fournisseur]", () => {
  it("sends the instructor back as connected when the first sync throws, logging ids only (#377)", async () => {
    const e = Object.assign(new Error("write failed: zz-refresh-token for Zz Camille"), { code: "57P01" });
    syncCalendar.mockRejectedValueOnce(e);

    const response = await callBack();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `https://ecole.example.test/mon-agenda/${SCHOOL}/jeton?agenda=connecte`,
    );
    expect(await response.text()).toBe("");
    expect(syncCalendar).toHaveBeenCalledWith(SCHOOL, INSTRUCTOR);
    expect(logged).toHaveBeenCalledOnce();
    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toContain(SCHOOL);
    expect(line).toContain(INSTRUCTOR);
    expect(line).toContain("Error 57P01");
    for (const leak of ["write failed", "zz-refresh-token", "Camille"]) expect(line).not.toContain(leak);
  });

  it("sends the instructor back as connected after a first sync", async () => {
    syncCalendar.mockResolvedValueOnce({ ok: true, ranges: 0 });
    const response = await callBack();
    expect(response.headers.get("location")).toContain("?agenda=connecte");
    expect(logged).not.toHaveBeenCalled();
  });
});
