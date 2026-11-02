import { describe, expect, it } from "vitest";
import {
  EMAIL_PROOF_DURATION_MS,
  EMAIL_PROOF_RESEND_MS,
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

describe("emailProofMessage", () => {
  const m = emailProofMessage({ school: "Zz École", url: "https://app.test/invitation/a/b/verification/c" });

  it("names the school and carries the link, in French", () => {
    expect(m.subject).toBe("Confirmez votre adresse e-mail pour rejoindre Zz École");
    expect(m.text).toContain("https://app.test/invitation/a/b/verification/c");
    expect(m.text).toContain("Zz École");
    expect(m.text).toMatch(/dans l’heure/);
  });

  it("tells someone who did not ask to ignore it", () => {
    expect(m.text).toMatch(/ignorez ce message/);
  });
});
