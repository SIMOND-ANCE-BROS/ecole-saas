import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withSchool } from "../db";
import { saveConnection } from "../db/calendar-connections";
import { decrypt, encrypt } from "./encryption";
import { syncCalendar } from "./calendar-sync";

/**
 * A refresh token the provider rotated during a failed sync is not lost when the sync's error
 * cannot be recorded (#381). Fake provider, no network call.
 */

// Writes fail while their flag is set (database down, lock timeout…).
const control = vi.hoisted(() => ({ failRecord: false, failToken: false }));
vi.mock("../db/calendar-connections", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/calendar-connections")>();
  return {
    ...original,
    recordSync: async (...args: Parameters<typeof original.recordSync>) => {
      if (control.failRecord && args[2].error !== null) throw new Error("write failed");
      return original.recordSync(...args);
    },
    saveRenewedToken: async (...args: Parameters<typeof original.saveRenewedToken>) => {
      if (control.failToken) throw new Error("write failed");
      return original.saveRenewedToken(...args);
    },
  };
});

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let instructorId: string;
const NOW = new Date("2026-11-01T08:00:00Z");

const response = (status: number, json: unknown) =>
  new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });

/** The provider rotates the token into `to`, then the calendar read fails; `sent` keeps the requests to the token endpoint. */
const rotatingThenDown =
  (to: string, sent: string[] = []): typeof fetch =>
  async (u, init) => {
    if (String(u).includes("/token")) {
      sent.push(String(init?.body));
      return response(200, { access_token: "acces", refresh_token: to });
    }
    return response(503, {});
  };

const connect = (token: string) =>
  withSchool(school, (tx) =>
    saveConnection(tx, instructorId, { provider: "microsoft", account: null, encryptedToken: encrypt(token) }),
  );

const storedToken = async () => {
  const [{ encrypted_token: encryptedToken }] =
    await admin`SELECT encrypted_token FROM calendar_connection WHERE instructor_id = ${instructorId}`;
  return encryptedToken as string;
};

beforeAll(async () => {
  process.env.CLE_CHIFFREMENT = randomBytes(32).toString("base64");
  process.env.MICROSOFT_CLIENT_ID = "client-test";
  process.env.MICROSOFT_CLIENT_SECRET = "secret-test";
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zz', ${`st-${suffix}`}) RETURNING id`;
  [{ id: instructorId }] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${school}, 'Zzdurand', 'Zzcamille', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
});

beforeEach(() => connect("fake-r1"));

afterEach(() => {
  control.failRecord = false;
  control.failToken = false;
});

afterAll(async () => {
  for (const t of ["unavailability", "calendar_connection", "instructor"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  }
  await admin`DELETE FROM school WHERE id = ${school}`;
  await admin.end();
});

describe("syncCalendar when its error cannot be recorded (#381)", () => {
  it("still saves the token the provider rotated, encrypted, and rethrows", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent: string[] = [];
    control.failRecord = true;
    try {
      await expect(syncCalendar(school, instructorId, rotatingThenDown("fake-r2", sent), NOW)).rejects.toThrow(
        "write failed",
      );
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
    expect(sent).toEqual([expect.stringContaining("refresh_token=fake-r1")]);
    const encryptedToken = await storedToken();
    expect(encryptedToken).not.toContain("fake-r2");
    expect(decrypt(encryptedToken)).toBe("fake-r2");
  });

  it("logs the lost token with ids and the error kind only when it cannot be saved either", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls: unknown[][] = [];
    control.failRecord = true;
    control.failToken = true;
    try {
      await expect(syncCalendar(school, instructorId, rotatingThenDown("fake-r2"), NOW)).rejects.toThrow(
        "write failed",
      );
    } finally {
      calls = [...logged.mock.calls];
      logged.mockRestore();
    }
    expect(decrypt(await storedToken())).toBe("fake-r1");

    expect(calls).toHaveLength(1);
    const line = String(calls[0]?.[0]);
    expect(line).toContain(school);
    expect(line).toContain(instructorId);
    expect(line).toContain("jeton d’agenda renouvelé perdu");
    expect(line).toContain("Error");
    for (const secret of ["fake-r1", "fake-r2", "acces", "write failed", "Zzdurand", "Zzcamille"]) {
      expect(line).not.toContain(secret);
    }
  });

  it("logs nothing more when the provider did not rotate the token", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    control.failRecord = true;
    control.failToken = true;
    try {
      const down: typeof fetch = async (u) =>
        String(u).includes("/token") ? response(200, { access_token: "acces" }) : response(503, {});
      await expect(syncCalendar(school, instructorId, down, NOW)).rejects.toThrow("write failed");
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
    expect(decrypt(await storedToken())).toBe("fake-r1");
  });

  it("does not overwrite a calendar reconnected during the sync", async () => {
    control.failRecord = true;
    const rotating = rotatingThenDown("fake-r2");
    const reconnectedMeanwhile: typeof fetch = async (u, init) => {
      if (String(u).includes("/token")) await connect("fake-new");
      return rotating(u, init);
    };
    await expect(syncCalendar(school, instructorId, reconnectedMeanwhile, NOW)).rejects.toThrow("write failed");
    expect(decrypt(await storedToken())).toBe("fake-new");
  });
});
