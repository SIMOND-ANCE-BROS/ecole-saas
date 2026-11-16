import { describe, expect, it, vi } from "vitest";
import { FAKE_OUTBOX, fakeSender, platformConfig, platformEmailSender } from "./sender";

describe("platformEmailSender", () => {
  const BREVO = { BREVO_API_KEY: "key-test", EMAIL_FROM_ADDRESS: "envoi@exemple.test", EMAIL_FROM_NAME: "Appli" };

  it("none without Brevo nor the fake sender", () => {
    expect(platformEmailSender({})).toBeNull();
  });

  it("Brevo once its key and a valid sender address are set, before the fake sender", () => {
    const sender = platformEmailSender({ ...BREVO, EMAIL_FAKE_ALLOWED: "1" });
    expect(sender).not.toBeNull();
    expect(sender).not.toBe(fakeSender);
    expect(platformConfig(BREVO)).toEqual({ apiKey: "key-test", fromAddress: "envoi@exemple.test", fromName: "Appli" });
  });

  it("not Brevo with a missing key or an invalid sender address", () => {
    expect(platformConfig({ ...BREVO, BREVO_API_KEY: " " })).toBeNull();
    expect(platformConfig({ ...BREVO, EMAIL_FROM_ADDRESS: "pas une adresse" })).toBeNull();
    expect(platformEmailSender({ ...BREVO, EMAIL_FROM_ADDRESS: "" })).toBeNull();
  });

  it("on a school's behalf: « École via App », one line, 70 characters at most", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(JSON.parse(String(init.body)));
        return new Response("{}", { status: 201 });
      }),
    );
    try {
      await platformEmailSender(BREVO, "École\r\nTest")?.send({ to: "zz@exemple.test", subject: "s", text: "t" });
      await platformEmailSender(BREVO, "É".repeat(100))?.send({ to: "zz@exemple.test", subject: "s", text: "t" });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(calls[0]).toMatchObject({ sender: { email: "envoi@exemple.test", name: "École  Test via Appli" } });
    expect((calls[1] as { sender: { name: string } }).sender.name).toHaveLength(70);
  });

  it("the sender name defaults to the address", () => {
    expect(platformConfig({ ...BREVO, EMAIL_FROM_NAME: "" })?.fromName).toBe("envoi@exemple.test");
  });

  it("the fake sender only where EMAIL_FAKE_ALLOWED=1", () => {
    expect(platformEmailSender({ EMAIL_FAKE_ALLOWED: "1" })).toBe(fakeSender);
    expect(platformEmailSender({ EMAIL_FAKE_ALLOWED: "true" })).toBeNull();
    expect(platformEmailSender({ EMAIL_FAKE_ALLOWED: "0" })).toBeNull();
  });

  it("never the fake sender in production, even with EMAIL_FAKE_ALLOWED=1 (#404)", () => {
    expect(platformEmailSender({ EMAIL_FAKE_ALLOWED: "1", NODE_ENV: "production" })).toBeNull();
    expect(platformEmailSender({ EMAIL_FAKE_ALLOWED: "1", NODE_ENV: "development" })).toBe(fakeSender);
    expect(platformEmailSender({ EMAIL_FAKE_ALLOWED: "1", NODE_ENV: "test" })).toBe(fakeSender);
  });

  it("the fake sender keeps the last 50 messages in memory", async () => {
    FAKE_OUTBOX.length = 0;
    for (let i = 0; i < 52; i++) {
      expect(await fakeSender.send({ to: `zz${i}@exemple.test`, subject: "Objet", text: "Texte" })).toEqual({
        ok: true,
      });
    }
    expect(FAKE_OUTBOX).toHaveLength(50);
    expect(FAKE_OUTBOX[0].to).toBe("zz2@exemple.test");
    expect(FAKE_OUTBOX.at(-1)?.to).toBe("zz51@exemple.test");
    FAKE_OUTBOX.length = 0;
  });
});
