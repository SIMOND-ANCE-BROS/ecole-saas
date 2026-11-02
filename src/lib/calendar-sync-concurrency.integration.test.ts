import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withSchool } from "../db";
import { saveConnection } from "../db/calendar-connections";
import { decrypt, encrypt } from "./encryption";
import { SYNC_RUNNING, syncCalendar, syncSchool } from "./calendar-sync";

/**
 * One sync at a time per calendar (#370): overlapping syncs (hourly job, « Synchroniser », OAuth
 * return) never refresh the same token. Fake Microsoft provider that rotates the refresh token on
 * every renewal, no network call.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let instructorId: string;
const NOW = new Date("2026-11-01T08:00:00Z");

const response = (status: number, json: unknown) =>
  new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });

/**
 * Fake provider: each renewal answers a new refresh token (`fake-rN`), after `gate` when given;
 * `sent` keeps the refresh tokens it received.
 */
function provider(sent: string[], gate?: Promise<void>): typeof fetch {
  return async (u, init) => {
    if (String(u).includes("/token")) {
      const token = new URLSearchParams(String(init?.body)).get("refresh_token") ?? "";
      sent.push(token);
      if (gate) await gate;
      return response(200, { access_token: "acces", refresh_token: `${token}-next` });
    }
    return response(200, { value: [] });
  };
}

/** A promise released by hand: the fake provider holds its renewal answer until then. */
function barrier() {
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  return { gate, release };
}

/** Waits until the fake provider received `n` renewals (the sync is then past its claim). */
async function untilSent(sent: string[], n: number) {
  for (let i = 0; i < 200 && sent.length < n; i++) await new Promise((r) => setTimeout(r, 10));
  expect(sent).toHaveLength(n);
}

const connect = (token: string) =>
  withSchool(school, (tx) =>
    saveConnection(tx, instructorId, { provider: "microsoft", account: null, encryptedToken: encrypt(token) }),
  );

const stored = async () => {
  const [row] = await admin`
    SELECT encrypted_token, sync_claimed_until FROM calendar_connection WHERE instructor_id = ${instructorId}`;
  return { token: decrypt(row.encrypted_token as string), claimed: row.sync_claimed_until as Date | null };
};

beforeAll(async () => {
  process.env.CLE_CHIFFREMENT = randomBytes(32).toString("base64");
  process.env.MICROSOFT_CLIENT_ID = "client-test";
  process.env.MICROSOFT_CLIENT_SECRET = "secret-test";
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zz', ${`sc-${suffix}`}) RETURNING id`;
  [{ id: instructorId }] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${school}, 'Zzmartin', 'Zzalex', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
});

beforeEach(() => connect("fake-r1"));

afterAll(async () => {
  for (const t of ["unavailability", "calendar_connection", "instructor"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  }
  await admin`DELETE FROM school WHERE id = ${school}`;
  await admin.end();
});

describe("overlapping syncs of one calendar (#370)", () => {
  it("skips the second sync while the first renews the token: one renewal, its token kept", async () => {
    const sent: string[] = [];
    const { gate, release } = barrier();
    const first = syncCalendar(school, instructorId, provider(sent, gate), NOW);
    await untilSent(sent, 1);

    const second = await syncCalendar(school, instructorId, provider(sent), NOW);
    expect(second).toEqual({ ok: false, busy: true, message: SYNC_RUNNING });

    release();
    expect(await first).toEqual({ ok: true, ranges: 0 });
    expect(sent).toEqual(["fake-r1"]);
    expect(await stored()).toEqual({ token: "fake-r1-next", claimed: null });

    // The claim released, the next sync renews the token the first one stored.
    expect((await syncCalendar(school, instructorId, provider(sent), NOW)).ok).toBe(true);
    expect(sent).toEqual(["fake-r1", "fake-r1-next"]);
    expect((await stored()).token).toBe("fake-r1-next-next");
  });

  it("releases the claim when the sync fails, so the next one runs", async () => {
    const sent: string[] = [];
    const down: typeof fetch = async (u, init) =>
      String(u).includes("/token") ? provider(sent)(u, init) : response(503, {});
    expect((await syncCalendar(school, instructorId, down, NOW)).ok).toBe(false);
    expect(await stored()).toEqual({ token: "fake-r1-next", claimed: null });
    expect((await syncCalendar(school, instructorId, provider(sent), NOW)).ok).toBe(true);
    expect(sent).toEqual(["fake-r1", "fake-r1-next"]);
  });

  it("takes over a claim that ran out (a sync that died), never a live one", async () => {
    const sent: string[] = [];
    await admin`UPDATE calendar_connection SET sync_claimed_until = now() + interval '4 minutes'
      WHERE instructor_id = ${instructorId}`;
    expect(await syncCalendar(school, instructorId, provider(sent), NOW)).toMatchObject({ busy: true });
    expect(sent).toEqual([]);

    await admin`UPDATE calendar_connection SET sync_claimed_until = now() - interval '1 second'
      WHERE instructor_id = ${instructorId}`;
    expect(await syncCalendar(school, instructorId, provider(sent), NOW)).toEqual({ ok: true, ranges: 0 });
    expect(sent).toEqual(["fake-r1"]);
    expect(await stored()).toEqual({ token: "fake-r1-next", claimed: null });
  });

  it("lets a reconnected calendar sync at once, and the old sync then writes nothing", async () => {
    const sent: string[] = [];
    const { gate, release } = barrier();
    const old = syncCalendar(school, instructorId, provider(sent, gate), NOW);
    await untilSent(sent, 1);

    await connect("fake-new");
    expect((await syncCalendar(school, instructorId, provider(sent), NOW)).ok).toBe(true);
    release();
    await old;

    expect(sent).toEqual(["fake-r1", "fake-new"]);
    expect(await stored()).toEqual({ token: "fake-new-next", claimed: null });
  });

  it("never claims another school's calendar", async () => {
    const [{ id: other }] =
      await admin`INSERT INTO school (name, slug) VALUES ('École Zz autre', ${`sc2-${suffix}`}) RETURNING id`;
    try {
      const sent: string[] = [];
      expect(await syncCalendar(other, instructorId, provider(sent), NOW)).toEqual({
        ok: false,
        message: "Aucun agenda connecté.",
      });
      expect(sent).toEqual([]);
      expect((await stored()).claimed).toBeNull();
    } finally {
      await admin`DELETE FROM school WHERE id = ${other}`;
    }
  });

  it("counts a calendar already being synced as skipped by the hourly job, not failed", async () => {
    await admin`UPDATE calendar_connection SET sync_claimed_until = now() + interval '4 minutes'
      WHERE instructor_id = ${instructorId}`;
    const sent: string[] = [];
    expect(await syncSchool(school, provider(sent))).toEqual({ succeeded: 0, failed: 0, unrecorded: 0, skipped: 1 });
    expect(sent).toEqual([]);
  });
});
