import { describe, expect, it } from "vitest";
import { FAKE_OUTBOX, emailSender, fakeSender } from "./sender";

describe("emailSender", () => {
  it("none until a provider is chosen (#105)", () => {
    expect(emailSender({})).toBeNull();
  });

  it("the fake sender only where EMAIL_FAKE_ALLOWED=1", () => {
    expect(emailSender({ EMAIL_FAKE_ALLOWED: "1" })).toBe(fakeSender);
    expect(emailSender({ EMAIL_FAKE_ALLOWED: "true" })).toBeNull();
    expect(emailSender({ EMAIL_FAKE_ALLOWED: "0" })).toBeNull();
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
