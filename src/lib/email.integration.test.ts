import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withSchool } from "../db";
import { deleteEmailSetting, readEmailSetting, saveEmailSetting } from "../db/email-connectors";
import { invite } from "../db/team";
import { FAKE_OUTBOX } from "../connectors/email/sender";
import { BREVO_URL, RESEND_URL } from "../connectors/email/providers";
import { createAccount } from "./accounts";
import { schoolEmailSender } from "./email";
import { decrypt } from "./encryption";
import { deliverLink } from "./invitations";

/**
 * A school's own e-mail account (#105, ADR 0009), against the real database:
 * RLS on `email_connector`, the API key never stored nor logged in clear, a
 * school only ever sends with its own account, and new links are e-mailed
 * through it, or shown when they cannot be. No real provider is called: fetch
 * is a mock. Fictitious data, deleted at the end.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const KEY_A = `zz-key-a-${suffix}`;
const KEY_B = `zz-key-b-${suffix}`;
const directorEmail = `zz-direction-mail-${suffix}@exemple.test`;
const NO_PLATFORM = {};
const FAKE = { EMAIL_FAKE_ALLOWED: "1", NODE_ENV: "test" };
let school: string;
let otherSchool: string;
let director: string;

const entry = (patch: Partial<Parameters<typeof saveEmailSetting>[2]> = {}) => ({
  provider: "resend" as const,
  fromAddress: "Contact@Ecole-A.exemple.test",
  fromName: "École A",
  apiKey: KEY_A,
  active: true,
  ...patch,
});

/** A fetch answering 200 and recording the URL and headers of each call. */
function recordingFetch() {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(u),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response("{}", { status: 200 });
  });
  return { fetch: fetchMock as unknown as typeof fetch, calls };
}

beforeAll(async () => {
  [{ id: school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École Mail A', ${`mail-a-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École Mail B', ${`mail-b-${suffix}`}) RETURNING id`;
  director = await createAccount({ email: directorEmail, name: "Zz Direction", password: "une phrase de test" });
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${director}, 'director')`;
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  await admin`DELETE FROM invitation WHERE school_id IN (${school}, ${otherSchool})`;
  await admin`DELETE FROM member WHERE school_id IN (${school}, ${otherSchool})`;
  await admin`DELETE FROM "user" WHERE email = ${directorEmail}`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("email_connector", () => {
  it("a first setting needs a key; saved, the key is encrypted and the address lowercased", async () => {
    expect(await withSchool(school, (tx) => saveEmailSetting(tx, director, entry({ apiKey: "" })))).toEqual({
      ok: false,
      message: "Saisissez la clé d’API du compte.",
    });
    expect(await withSchool(school, (tx) => saveEmailSetting(tx, director, entry()))).toEqual({ ok: true });
    const [row] = await admin`SELECT * FROM email_connector WHERE school_id = ${school}`;
    expect(row.encrypted_api_key).not.toContain(KEY_A);
    expect(row.encrypted_api_key).toMatch(/^v1\./);
    expect(decrypt(row.encrypted_api_key)).toBe(KEY_A);
    expect(row.from_address).toBe("contact@ecole-a.exemple.test");
    expect(await withSchool(school, (tx) => readEmailSetting(tx))).toEqual({
      provider: "resend",
      fromAddress: "contact@ecole-a.exemple.test",
      fromName: "École A",
      active: true,
    });
  });

  it("the database refuses a key in clear", async () => {
    await expect(
      admin`UPDATE email_connector SET encrypted_api_key = ${KEY_A} WHERE school_id = ${school}`,
    ).rejects.toThrow(/email_connector_key/);
  });

  it("an empty key keeps the saved one; another provider needs its own key", async () => {
    const [before] = await admin`SELECT encrypted_api_key FROM email_connector WHERE school_id = ${school}`;
    expect(
      await withSchool(school, (tx) => saveEmailSetting(tx, director, entry({ apiKey: "", fromName: "École A bis" }))),
    ).toEqual({ ok: true });
    const [after] = await admin`SELECT encrypted_api_key, from_name FROM email_connector WHERE school_id = ${school}`;
    expect(after).toEqual({ encrypted_api_key: before.encrypted_api_key, from_name: "École A bis" });
    expect(
      await withSchool(school, (tx) => saveEmailSetting(tx, director, entry({ provider: "brevo", apiKey: "" }))),
    ).toMatchObject({ ok: false });
  });

  it("the audit log says whether the key changed, never the key", async () => {
    const rows = await admin`SELECT action, before, after FROM audit_log
      WHERE school_id = ${school} AND target_table = 'email_connector' ORDER BY id`;
    expect(rows.map((r) => [r.action, r.after.api_key_changed])).toEqual([
      ["insert", true],
      ["update", false],
    ]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(KEY_A);
    expect(text).not.toContain("v1.");
  });

  it("another school sees nothing of it and cannot write it (RLS)", async () => {
    expect(await withSchool(otherSchool, (tx) => readEmailSetting(tx))).toBeNull();
    expect(await withSchool(otherSchool, (tx) => deleteEmailSetting(tx, director))).toMatchObject({ ok: false });
    expect(await admin`SELECT 1 FROM email_connector WHERE school_id = ${school}`).toHaveLength(1);
    const refused = await withSchool(otherSchool, (tx) =>
      tx.execute(
        sql`INSERT INTO email_connector (school_id, provider, encrypted_api_key, from_address, from_name)
              VALUES (${school}, 'brevo', 'v1.x.y.z', 'a@b.test', 'X')
              ON CONFLICT (school_id) DO NOTHING`,
      ),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(refused instanceof Error && String(refused.cause)).toMatch(/row-level security/);
  });
});

describe("schoolEmailSender", () => {
  it("each school sends with its own account only, never another's", async () => {
    // School B has its own Brevo account; school A its Resend one.
    expect(
      await withSchool(otherSchool, (tx) =>
        saveEmailSetting(tx, director, entry({ provider: "brevo", apiKey: KEY_B, fromAddress: "b@ecole-b.test" })),
      ),
    ).toEqual({ ok: true });
    const f = recordingFetch();
    const a = await schoolEmailSender(school, NO_PLATFORM, { fetch: f.fetch, pauseMs: 0 });
    const b = await schoolEmailSender(otherSchool, NO_PLATFORM, { fetch: f.fetch, pauseMs: 0 });
    expect(a.route).toEqual({ kind: "school", provider: "resend" });
    expect(b.route).toEqual({ kind: "school", provider: "brevo" });
    await a.sender?.send({ to: "zz@exemple.test", subject: "s", text: "t" });
    await b.sender?.send({ to: "zz@exemple.test", subject: "s", text: "t" });
    expect(f.calls[0]).toMatchObject({ url: RESEND_URL, headers: { authorization: `Bearer ${KEY_A}` } });
    expect(f.calls[1]).toMatchObject({ url: BREVO_URL, headers: { "api-key": KEY_B } });
    expect(f.calls[0].body.from).toBe('"École A bis" <contact@ecole-a.exemple.test>');
  });

  it("a school without an account (or with it switched off) gets the application sender, or none", async () => {
    await withSchool(otherSchool, (tx) => deleteEmailSetting(tx, director));
    expect((await schoolEmailSender(otherSchool, NO_PLATFORM)).route).toEqual({ kind: "none" });
    expect((await schoolEmailSender(otherSchool, FAKE)).route).toEqual({ kind: "fake" });
    const f = recordingFetch();
    const platform = await schoolEmailSender(
      otherSchool,
      { BREVO_API_KEY: "zz-platform", EMAIL_FROM_ADDRESS: "envoi@appli.test", EMAIL_FROM_NAME: "Appli" },
      { fetch: f.fetch },
    );
    expect(platform.route).toEqual({ kind: "platform" });
    await withSchool(school, (tx) => saveEmailSetting(tx, director, entry({ apiKey: "", active: false })));
    expect((await schoolEmailSender(school, NO_PLATFORM)).route).toEqual({ kind: "none" });
    await withSchool(school, (tx) => saveEmailSetting(tx, director, entry({ apiKey: "", active: true })));
  });

  it("a key this server cannot decrypt is reported broken, with no sender (no silent fall back)", async () => {
    await admin`UPDATE email_connector SET encrypted_api_key = 'v1.AAAA.BBBB.CCCC' WHERE school_id = ${school}`;
    expect(await schoolEmailSender(school, FAKE)).toEqual({
      route: { kind: "broken", provider: "resend" },
      sender: null,
    });
    await withSchool(school, (tx) => saveEmailSetting(tx, director, entry()));
  });
});

describe("deliverLink", () => {
  const newInvitation = async (email: string) => {
    const r = await withSchool(school, (tx) =>
      invite(tx, director, { email, name: "Zz Invitée", role: "front_desk" }, new Date()),
    );
    if (!r.ok) throw new Error(r.message);
    return r.token;
  };

  it("e-mails the invitation to the invited address, through the school's sender, without showing it", async () => {
    FAKE_OUTBOX.length = 0;
    const token = await newInvitation(`zz-invitee-1-${suffix}@exemple.test`);
    const f = recordingFetch();
    const r = await deliverLink(school, token, (id) => schoolEmailSender(id, FAKE, { fetch: f.fetch }));
    // School A has its own account: it goes there, not to the fake sender of the environment.
    expect(r).toEqual({ sent: true, to: `zz-invitee-1-${suffix}@exemple.test` });
    expect(FAKE_OUTBOX).toHaveLength(0);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ url: RESEND_URL, body: { to: [`zz-invitee-1-${suffix}@exemple.test`] } });
    await withSchool(school, (tx) => deleteEmailSetting(tx, director));
    const sent = await deliverLink(school, token, (id) => schoolEmailSender(id, FAKE));
    expect(sent).toEqual({ sent: true, to: `zz-invitee-1-${suffix}@exemple.test` });
    expect(FAKE_OUTBOX).toHaveLength(1);
    expect(FAKE_OUTBOX[0].to).toBe(`zz-invitee-1-${suffix}@exemple.test`);
    expect(FAKE_OUTBOX[0].subject).toBe("Invitation à rejoindre Zz École Mail A");
    expect(FAKE_OUTBOX[0].text).toContain(`/invitation/${school}/${token}`);
  });

  it("shows the link, with why, when the school's provider refuses", async () => {
    await withSchool(school, (tx) => saveEmailSetting(tx, director, entry()));
    const refusing = vi.fn(async () => new Response('{"name":"validation_error"}', { status: 403 }));
    const token = await newInvitation(`zz-invitee-2-${suffix}@exemple.test`);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await deliverLink(school, token, (id) =>
      schoolEmailSender(id, NO_PLATFORM, { fetch: refusing as unknown as typeof fetch, pauseMs: 0 }),
    );
    expect(r).toMatchObject({ sent: false, link: expect.stringContaining(token) });
    expect(r.sent === false && r.notice).toContain("clé d’API est refusée");
    // The log names ids and the status, never the address.
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).not.toContain("exemple.test");
    expect(String(errors.mock.calls[0][0])).toContain("403");
    errors.mockRestore();
  });

  it("shows the link, without a notice, when no sender exists at all", async () => {
    await withSchool(school, (tx) => deleteEmailSetting(tx, director));
    const token = await newInvitation(`zz-invitee-3-${suffix}@exemple.test`);
    expect(await deliverLink(school, token, (id) => schoolEmailSender(id, NO_PLATFORM))).toEqual({
      sent: false,
      link: expect.stringContaining(token),
      notice: null,
    });
  });

  it("another school's token is never e-mailed nor shown as valid", async () => {
    const token = await newInvitation(`zz-invitee-4-${suffix}@exemple.test`);
    FAKE_OUTBOX.length = 0;
    const r = await deliverLink(otherSchool, token, (id) => schoolEmailSender(id, FAKE));
    expect(r).toMatchObject({ sent: false, notice: null });
    expect(FAKE_OUTBOX).toHaveLength(0);
  });
});
