import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withSchool } from "../db";
import { deleteConnection, saveConnection } from "../db/calendar-connections";
import type { Provider } from "../connectors/calendar/oauth";
import { decrypt, encrypt } from "./encryption";
import { SYNC_RECONNECTED, syncCalendar } from "./calendar-sync";

/**
 * Busy slots belong to the connection that read them (#386): a sync whose calendar was reconnected
 * meanwhile writes none and reports no success; reconnecting with another provider removes the
 * upcoming slots of the previous one, like a disconnection. Fake provider, no network call.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let instructorId: string;
const NOW = new Date();
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

const response = (status: number, json: unknown) =>
  new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });

const connect = (provider: Provider, token: string) =>
  withSchool(school, (tx) =>
    saveConnection(tx, instructorId, { provider, account: null, encryptedToken: encrypt(token) }),
  );

/** One busy event of Microsoft's calendarView, tomorrow, in UTC as requested. */
const event = { start: { dateTime: at(24).toISOString() }, end: { dateTime: at(25).toISOString() }, showAs: "busy" };

const slots = async () =>
  (
    await admin`SELECT source, starts_at FROM unavailability WHERE instructor_id = ${instructorId} ORDER BY starts_at`
  ).map((r) => ({ source: r.source as string, startsAt: (r.starts_at as Date).toISOString() }));

const addSlot = (source: string, start: Date, end: Date) =>
  admin`INSERT INTO unavailability (school_id, instructor_id, starts_at, ends_at, source)
    VALUES (${school}, ${instructorId}, ${start}, ${end}, ${source})`;

beforeAll(async () => {
  process.env.CLE_CHIFFREMENT = randomBytes(32).toString("base64");
  process.env.MICROSOFT_CLIENT_ID = "client-test";
  process.env.MICROSOFT_CLIENT_SECRET = "secret-test";
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zz', ${`sr-${suffix}`}) RETURNING id`;
  [{ id: instructorId }] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${school}, 'Zzbernard', 'Zzsacha', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
});

beforeEach(async () => {
  await admin`DELETE FROM unavailability WHERE school_id = ${school}`;
  await connect("microsoft", "fake-r1");
});

afterAll(async () => {
  for (const t of ["unavailability", "calendar_connection", "instructor"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  }
  await admin`DELETE FROM school WHERE id = ${school}`;
  await admin.end();
});

describe("a sync whose calendar was reconnected meanwhile (#386)", () => {
  it("writes none of the slots it read and does not report a success", async () => {
    const reconnectingDuringRead: typeof fetch = async (u) => {
      if (String(u).includes("/token")) return response(200, { access_token: "acces", refresh_token: "fake-r2" });
      await connect("microsoft", "fake-new");
      return response(200, { value: [event] });
    };
    expect(await syncCalendar(school, instructorId, reconnectingDuringRead, NOW)).toEqual({
      ok: false,
      message: SYNC_RECONNECTED,
    });
    expect(await slots()).toEqual([]);
    const [row] = await admin`SELECT encrypted_token, last_synced_at, error FROM calendar_connection
      WHERE instructor_id = ${instructorId}`;
    expect(decrypt(row.encrypted_token as string)).toBe("fake-new");
    expect(row.last_synced_at).toBeNull();
    expect(row.error).toBeNull();
  });

  it("keeps the slots a sync of the new connection already wrote", async () => {
    await addSlot("microsoft", at(48), at(49));
    const reconnectingDuringRead: typeof fetch = async (u) => {
      if (String(u).includes("/token")) return response(200, { access_token: "acces" });
      await connect("microsoft", "fake-new");
      return response(200, { value: [event] });
    };
    expect((await syncCalendar(school, instructorId, reconnectingDuringRead, NOW)).ok).toBe(false);
    expect(await slots()).toEqual([{ source: "microsoft", startsAt: at(48).toISOString() }]);
  });

  it("writes no slot when the calendar was disconnected during the read", async () => {
    const disconnectingDuringRead: typeof fetch = async (u) => {
      if (String(u).includes("/token")) return response(200, { access_token: "acces" });
      await withSchool(school, (tx) => deleteConnection(tx, instructorId));
      return response(200, { value: [event] });
    };
    expect(await syncCalendar(school, instructorId, disconnectingDuringRead, NOW)).toEqual({
      ok: false,
      message: SYNC_RECONNECTED,
    });
    expect(await slots()).toEqual([]);
  });

  it("still writes the slots and the sync when nothing was reconnected", async () => {
    const provider: typeof fetch = async (u) =>
      String(u).includes("/token") ? response(200, { access_token: "acces" }) : response(200, { value: [event] });
    expect(await syncCalendar(school, instructorId, provider, NOW)).toEqual({ ok: true, ranges: 1 });
    expect(await slots()).toEqual([{ source: "microsoft", startsAt: at(24).toISOString() }]);
  });
});

describe("reconnecting a calendar (#386)", () => {
  beforeEach(async () => {
    await addSlot("microsoft", at(-48), at(-47)); // past
    await addSlot("microsoft", at(-1), at(1)); // under way
    await addSlot("microsoft", at(24 * 200), at(24 * 200 + 1)); // beyond any sync window
    await addSlot("manual", at(30), at(31));
  });

  it("with another provider removes the upcoming slots of the previous one, manual ones kept", async () => {
    await connect("google", "fake-g1");
    expect(await slots()).toEqual([
      { source: "microsoft", startsAt: at(-48).toISOString() },
      { source: "manual", startsAt: at(30).toISOString() },
    ]);
  });

  it("with the same provider keeps its slots until its next sync replaces them", async () => {
    await connect("microsoft", "fake-again");
    expect(await slots()).toHaveLength(4);
  });
});
