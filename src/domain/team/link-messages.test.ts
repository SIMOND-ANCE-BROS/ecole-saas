import { describe, expect, it } from "vitest";
import { LINK_EMAILS_SCHOOL_DAILY_MAX, linkEmailHold, linkMessage, mailText } from "./link-messages";

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

describe("mailText", () => {
  it("keeps one line: line breaks, controls and direction marks become spaces", () => {
    expect(mailText("Zz\r\nCliquez ici\u0000 \u202Eevil\u2028x")).toBe("Zz Cliquez ici evil x");
  });

  it("caps the length at 100 characters", () => {
    expect(mailText("a".repeat(150))).toHaveLength(100);
  });

  it("is applied to the name and the school of the e-mail", () => {
    const m = linkMessage({ kind: "invitation", school: "École\nFausse ligne", name: "Zz\nhttp://x", url: URL });
    expect(m.subject).toBe("Invitation à rejoindre École Fausse ligne");
    expect(m.text.split("\n")[0]).toBe("Bonjour Zz http://x,");
  });
});

describe("linkEmailHold", () => {
  const now = new Date("2026-11-16T10:00:00Z");
  const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);

  it("nothing earlier: the e-mail goes", () => {
    expect(linkEmailHold({ person: [], school: [] }, now)).toBeNull();
  });

  it("the same person two minutes apart, five a day", () => {
    expect(linkEmailHold({ person: [minutesAgo(1)], school: [minutesAgo(1)] }, now)).toEqual({
      scope: "person",
      wait: 60,
    });
    const five = [10, 20, 30, 40, 50].map(minutesAgo);
    expect(linkEmailHold({ person: five, school: five }, now)).toMatchObject({ scope: "person" });
    expect(linkEmailHold({ person: five.slice(1), school: five }, now)).toBeNull();
  });

  it("the school: LINK_EMAILS_SCHOOL_DAILY_MAX a day, all people together; older ones no longer count", () => {
    const many = Array.from({ length: LINK_EMAILS_SCHOOL_DAILY_MAX }, (_, i) => minutesAgo(10 + i));
    expect(linkEmailHold({ person: [], school: many }, now)).toEqual({
      scope: "school",
      wait: 24 * 3600 - (10 + LINK_EMAILS_SCHOOL_DAILY_MAX - 1) * 60,
    });
    expect(linkEmailHold({ person: [], school: many.slice(1) }, now)).toBeNull();
    expect(linkEmailHold({ person: [], school: [...many.slice(1), minutesAgo(25 * 60)] }, now)).toBeNull();
  });
});
