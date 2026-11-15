import { describe, expect, it } from "vitest";
import { linkMessage } from "./link-messages";

const URL = "https://app.exemple.test/invitation/s/t";

describe("linkMessage", () => {
  it("an invitation names the school, the person, the link and its 7 days", () => {
    const m = linkMessage({ kind: "invitation", school: "École Test", name: "Zoé Exemple", url: URL });
    expect(m.subject).toBe("Invitation à rejoindre École Test");
    expect(m.text).toContain("Bonjour Zoé Exemple,");
    expect(m.text).toContain(URL);
    expect(m.text).toContain("7 jours");
  });

  it("a password link says 24 hours and that the current password still works", () => {
    const m = linkMessage({ kind: "reset", school: "École Test", name: null, url: URL });
    expect(m.subject).toBe("Nouveau mot de passe pour École Test");
    expect(m.text.startsWith("Bonjour,")).toBe(true);
    expect(m.text).toContain("24 heures");
    expect(m.text).toContain("reste valable");
  });

  it("the link stands on a line of its own (mail clients make it clickable)", () => {
    const m = linkMessage({ kind: "invitation", school: "É", name: null, url: URL });
    expect(m.text.split("\n")).toContain(URL);
  });
});
