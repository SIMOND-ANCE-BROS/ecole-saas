import { describe, expect, it } from "vitest";
import {
  EMAIL_PROOF_DURATION_MS,
  EMAIL_PROOF_RESEND_MS,
  EMAIL_PROOF_DAILY_MAX,
  EMAIL_PROOF_DURATION_TEXT,
  addressWait,
  retryIn,
  emailProofMessage,
  joinProof,
  resendWait,
} from "./email-proof";

describe("joinProof", () => {
  it("a new e-mail creates its access, whether or not e-mail can be sent", () => {
    expect(joinProof(null, true)).toBe("create");
    expect(joinProof(null, false)).toBe("create");
  });

  it("a verified account confirms its current password", () => {
    expect(joinProof({ emailVerified: true }, true)).toBe("password");
    expect(joinProof({ emailVerified: true }, false)).toBe("password");
  });

  it("an unverified account proves its e-mail before joining another school, once e-mail can be sent", () => {
    expect(joinProof({ emailVerified: false }, true)).toBe("email");
  });

  it("without an e-mail service, an unverified account still confirms its password (until #105)", () => {
    expect(joinProof({ emailVerified: false }, false)).toBe("password");
  });
});

describe("resendWait", () => {
  const now = new Date("2026-11-02T10:00:00Z");

  it("no wait when nothing was sent yet or the delay is over", () => {
    expect(resendWait(null, now)).toBe(0);
    expect(resendWait(new Date(now.getTime() - EMAIL_PROOF_RESEND_MS), now)).toBe(0);
  });

  it("whole seconds left before another e-mail may go, rounded up", () => {
    expect(resendWait(new Date(now.getTime() - 1), now)).toBe(Math.ceil(EMAIL_PROOF_RESEND_MS / 1000));
    expect(resendWait(new Date(now.getTime() - EMAIL_PROOF_RESEND_MS + 1500), now)).toBe(2);
  });

  it("the link lasts longer than the delay between two e-mails", () => {
    expect(EMAIL_PROOF_DURATION_MS).toBeGreaterThan(EMAIL_PROOF_RESEND_MS);
  });
});

describe("addressWait", () => {
  const now = new Date("2026-11-02T10:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  it("spaces the e-mails of an address by two minutes, whatever the invitation", () => {
    expect(addressWait([], now)).toBe(0);
    expect(addressWait([ago(60), ago(1)], now)).toBe(60);
    expect(addressWait([ago(3)], now)).toBe(0);
  });

  it("no more than five in 24 hours, then waits for the oldest to be a day old", () => {
    const five = [ago(600), ago(500), ago(400), ago(300), ago(200)];
    expect(five).toHaveLength(EMAIL_PROOF_DAILY_MAX);
    expect(addressWait(five, now)).toBe((24 * 60 - 600) * 60);
    expect(addressWait(five.slice(1), now)).toBe(0);
    // Older than a day: not counted.
    expect(addressWait([ago(25 * 60), ...five.slice(1)], now)).toBe(0);
  });
});

describe("retryIn", () => {
  it("says the wait in minutes or hours, rounded up", () => {
    expect(retryIn(1)).toBe("dans une minute");
    expect(retryIn(60)).toBe("dans une minute");
    expect(retryIn(61)).toBe("dans 2 minutes");
    expect(retryIn(59 * 60)).toBe("dans 59 minutes");
    expect(retryIn(3600)).toBe("dans une heure");
    expect(retryIn(3601)).toBe("dans 2 heures");
  });
});

describe("emailProofMessage", () => {
  const m = emailProofMessage({ school: "Zz École", url: "https://app.test/invitation/a/b/verification/c" });

  it("names the school and carries the link, in French", () => {
    expect(m.subject).toBe("Confirmez votre adresse e-mail pour rejoindre Zz École");
    expect(m.text).toContain("https://app.test/invitation/a/b/verification/c");
    expect(m.text).toContain("Zz École");
    expect(m.text).toContain(EMAIL_PROOF_DURATION_TEXT);
    // The words match the duration.
    expect(EMAIL_PROOF_DURATION_TEXT).toBe("dans l’heure");
    expect(EMAIL_PROOF_DURATION_MS).toBe(60 * 60_000);
  });

  it("tells someone who did not ask to ignore it", () => {
    expect(m.text).toMatch(/ignorez ce message/);
  });
});
