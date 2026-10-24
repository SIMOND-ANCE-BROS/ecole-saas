import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "../db";
import { saveConnection, connectionState, deleteConnection } from "../db/calendar-connections";
import { readInstructor, updateInstructor } from "../db/instructors";
import { listUnavailabilities } from "../db/unavailabilities";
import { encrypt, decrypt } from "./encryption";
import { syncCalendar } from "./calendar-sync";

/** Sync of a connected calendar, with a fake provider (no network call). */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let camille: string;
const NOW = new Date("2026-11-01T08:00:00Z");

const response = (status: number, json: unknown) =>
  new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });

beforeAll(async () => {
  process.env.CLE_CHIFFREMENT = randomBytes(32).toString("base64");
  process.env.MICROSOFT_CLIENT_ID = "client-test";
  process.env.MICROSOFT_CLIENT_SECRET = "secret-test";
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`sy-${suffix}`}) RETURNING id`;
  [{ id: camille }] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${school}, 'Durand', 'Camille', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  await withSchool(school, (tx) =>
    saveConnection(tx, camille, {
      provider: "microsoft",
      account: "camille@exemple.test",
      encryptedToken: encrypt("fake-r1"),
    }),
  );
  await admin`INSERT INTO unavailability (school_id, instructor_id, starts_at, ends_at, source, label)
    VALUES (${school}, ${camille}, '2099-11-10T09:00:00Z', '2099-11-10T10:00:00Z', 'manual', 'Rendez-vous')`;
});

afterAll(async () => {
  for (const t of ["unavailability", "calendar_connection", "instructor"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  }
  await admin`DELETE FROM school WHERE id = ${school}`;
  await admin.end();
});

const rangesOf = () => withSchool(school, (tx) => listUnavailabilities(tx, camille, NOW));

describe("syncCalendar", () => {
  it("keeps the token encrypted in the database, never in clear", async () => {
    const [{ encrypted_token: jeton_chiffre }] =
      await admin`SELECT encrypted_token FROM calendar_connection WHERE instructor_id = ${camille}`;
    expect(jeton_chiffre).not.toContain("fake-r1");
    expect(decrypt(jeton_chiffre)).toBe("fake-r1");
  });

  it("saves busy ranges, keeps manual entries, and takes the renewed token", async () => {
    const attendances: string[] = [];
    const fakeFetch: typeof fetch = async (u, init) => {
      attendances.push(String(u));
      if (String(u).includes("/token")) {
        expect(String(init?.body)).toContain("refresh_token=fake-r1");
        return response(200, { access_token: "acces", refresh_token: "fake-r2" });
      }
      return response(200, {
        value: [
          { start: { dateTime: "2026-11-04T15:00:00" }, end: { dateTime: "2026-11-04T17:00:00" }, showAs: "busy" },
        ],
      });
    };
    expect(await syncCalendar(school, camille, fakeFetch, NOW)).toEqual({ ok: true, ranges: 1 });
    expect((await rangesOf()).map((i) => `${i.source} ${i.start.toISOString()}`)).toEqual([
      "microsoft 2026-11-04T15:00:00.000Z",
      "manual 2099-11-10T09:00:00.000Z",
    ]);
    const [{ encrypted_token: jeton_chiffre }] =
      await admin`SELECT encrypted_token FROM calendar_connection WHERE instructor_id = ${camille}`;
    expect(decrypt(jeton_chiffre)).toBe("fake-r2");
    expect(await withSchool(school, (tx) => connectionState(tx, camille))).toMatchObject({
      account: "camille@exemple.test",
      error: null,
    });
    expect(attendances).toHaveLength(2);
  });

  it("records revoked access without losing ranges already read", async () => {
    const r = await syncCalendar(school, camille, async () => response(400, { error: "invalid_grant" }), NOW);
    expect(r).toEqual({ ok: false, message: "Accès à l’agenda retiré ou expiré : reconnecter l’agenda." });
    expect((await withSchool(school, (tx) => connectionState(tx, camille)))?.error).toBe(
      "Accès à l’agenda retiré ou expiré : reconnecter l’agenda.",
    );
    expect(await rangesOf()).toHaveLength(2);
  });

  it("reveals nothing about a provider outage", async () => {
    const panne: typeof fetch = async () => {
      throw new Error("ECONNRESET camille@exemple.test");
    };
    expect(await syncCalendar(school, camille, panne, NOW)).toEqual({
      ok: false,
      message: "Synchronisation impossible pour le moment ; elle sera retentée.",
    });
  });

  it("disconnects the calendar; manual entries remain", async () => {
    expect(await withSchool(school, (tx) => deleteConnection(tx, camille))).toBe(true);
    expect((await rangesOf()).some((i) => i.source === "manual")).toBe(true);
    expect(await syncCalendar(school, camille, fetch, NOW)).toEqual({
      ok: false,
      message: "Aucun agenda connecté.",
    });
  });

  it("neither saves nor syncs the calendar of a deactivated instructor, and deletes its connection", async () => {
    await withSchool(school, (tx) =>
      saveConnection(tx, camille, { provider: "microsoft", account: null, encryptedToken: encrypt("r") }),
    );
    const record = await withSchool(school, (tx) => readInstructor(tx, camille));
    if (!record) throw new Error("intervenant introuvable");
    const { id, ...entry } = record;
    expect(id).toBe(camille);
    await withSchool(school, (tx) => updateInstructor(tx, camille, { ...entry, active: false }));
    expect(await withSchool(school, (tx) => connectionState(tx, camille))).toBeNull();
    expect(
      await withSchool(school, (tx) =>
        saveConnection(tx, camille, { provider: "microsoft", account: null, encryptedToken: encrypt("r") }),
      ),
    ).toBe(false);
    // Even a row left in the database (restore) is ignored.
    await admin`INSERT INTO calendar_connection (school_id, instructor_id, provider, encrypted_token) VALUES (${school}, ${camille}, 'microsoft', ${encrypt("r")})`;
    expect(await syncCalendar(school, camille, fetch, NOW)).toEqual({
      ok: false,
      message: "Aucun agenda connecté.",
    });
  });
});
