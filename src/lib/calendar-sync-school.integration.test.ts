import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withSchool } from "../db";
import { connectionState, saveConnection } from "../db/calendar-connections";
import { encrypt } from "./encryption";
import { syncSchool } from "./calendar-sync";

/**
 * A school's calendars are synced one after the other: one instructor whose error cannot even
 * be recorded must not stop the others (#373). Fake provider, no network call.
 */

// Recording an error fails while `failRecord` is set (database down, lock timeout…).
const control = vi.hoisted(() => ({ failRecord: false, failedFor: [] as string[] }));
vi.mock("../db/calendar-connections", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/calendar-connections")>();
  return {
    ...original,
    recordSync: async (...args: Parameters<typeof original.recordSync>) => {
      if (control.failRecord && args[2].error !== null) {
        control.failedFor.push(args[1]);
        throw new Error("write failed");
      }
      return original.recordSync(...args);
    },
  };
});

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
const instructors: string[] = [];
const NAMES = ["Durand", "Martin", "Petit"];

const response = (status: number, json: unknown) =>
  new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });

beforeAll(async () => {
  process.env.CLE_CHIFFREMENT = randomBytes(32).toString("base64");
  process.env.MICROSOFT_CLIENT_ID = "client-test";
  process.env.MICROSOFT_CLIENT_SECRET = "secret-test";
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ss-${suffix}`}) RETURNING id`;
  for (const name of NAMES) {
    const [{ id }] =
      await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${school}, ${name}, 'Camille', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
    instructors.push(id);
    await withSchool(school, (tx) =>
      saveConnection(tx, id, { provider: "microsoft", account: null, encryptedToken: encrypt(`fake-${id}`) }),
    );
  }
});

afterAll(async () => {
  for (const t of ["unavailability", "calendar_connection", "instructor"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  }
  await admin`DELETE FROM school WHERE id = ${school}`;
  await admin.end();
});

describe("syncSchool", () => {
  it("syncs the other instructors when the first one's error cannot be recorded (#373)", async () => {
    // The first calendar synced has its access revoked; the others answer normally.
    const refreshed: string[] = [];
    const fakeFetch: typeof fetch = async (u, init) => {
      if (String(u).includes("/token")) {
        refreshed.push(String(init?.body));
        if (refreshed.length === 1) return response(400, { error: "invalid_grant" });
        return response(200, { access_token: "acces" });
      }
      return response(200, { value: [] });
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls: unknown[][] = [];
    control.failRecord = true;
    try {
      expect(await syncSchool(school, fakeFetch)).toEqual({ succeeded: 2, failed: 1, unrecorded: 1 });
    } finally {
      control.failRecord = false;
      calls = [...logged.mock.calls];
      logged.mockRestore();
    }

    expect(refreshed).toHaveLength(3);
    const states = await withSchool(school, (tx) => Promise.all(instructors.map((id) => connectionState(tx, id))));
    const synced = states.filter((s) => s?.lastSyncedAt);
    expect(synced).toHaveLength(2);
    expect(synced.every((s) => s?.error === null)).toBe(true);

    // One line with the school and instructor ids and the error kind, never a name.
    expect(calls).toHaveLength(1);
    const line = String(calls[0]?.[0]);
    expect(line).toContain(school);
    expect(control.failedFor).toHaveLength(1);
    expect(line).toContain(control.failedFor[0]);
    expect(line).toContain("Error");
    expect(line).not.toContain("write failed");
    for (const name of [...NAMES, "Camille"]) expect(line).not.toContain(name);
  });

  it("counts a recorded failure without calling it unrecorded", async () => {
    const fakeFetch: typeof fetch = async (u) =>
      String(u).includes("/token") ? response(503, {}) : response(200, { value: [] });
    expect(await syncSchool(school, fakeFetch)).toEqual({ succeeded: 0, failed: 3, unrecorded: 0 });
  });
});
