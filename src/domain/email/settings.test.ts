import { describe, expect, it } from "vitest";
import { routeLabel, sendFailureMessage } from "./settings";

describe("sendFailureMessage", () => {
  it("a refused key says to check the key", () => {
    expect(sendFailureMessage({ reason: "refused", status: 401 })).toContain("clé d’API est refusée");
    expect(sendFailureMessage({ reason: "refused", status: 403 })).toContain("clé d’API est refusée");
  });

  it("another refusal points at the sending domain (SPF, DKIM)", () => {
    expect(sendFailureMessage({ reason: "refused", status: 400 })).toContain("DKIM");
  });

  it("a quota, an outage and a timeout ask to retry later", () => {
    expect(sendFailureMessage({ reason: "unavailable", status: 429 })).toContain("quota");
    expect(sendFailureMessage({ reason: "unavailable", status: 503 })).toContain("indisponible");
    expect(sendFailureMessage({ reason: "unavailable" })).toContain("indisponible");
    expect(sendFailureMessage({ reason: "timeout" })).toContain("à temps");
  });
});

describe("routeLabel", () => {
  it("says which account sends, and that links are shown when nothing can", () => {
    expect(routeLabel({ kind: "school", provider: "resend" })).toContain("compte Resend de l’école");
    expect(routeLabel({ kind: "platform" })).toContain("service d’envoi de l’application");
    expect(routeLabel({ kind: "fake" })).toContain("simulation");
    expect(routeLabel({ kind: "broken", provider: "brevo" })).toContain("enregistrez de nouveau sa clé");
    expect(routeLabel({ kind: "none" })).toContain("transmis à la main");
  });
});
