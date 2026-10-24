import { describe, expect, it } from "vitest";
import { type TeamMember, changeRefusal, passwordRefusal } from "./rules";

const TEAM: TeamMember[] = [
  { id: "diana", role: "director", active: true },
  { id: "anthony", role: "director", active: true },
  { id: "front_desk", role: "front_desk", active: true },
];

describe("changeRefusal", () => {
  it("allows changing another member's role or activity", () => {
    expect(changeRefusal(TEAM, "diana", "front_desk", { role: "director", active: true })).toBeNull();
    expect(changeRefusal(TEAM, "diana", "anthony", { role: "director", active: false })).toBeNull();
  });

  it("refuses to change one's own access", () => {
    expect(changeRefusal(TEAM, "diana", "diana", { role: "front_desk", active: true })).toMatch(/propre accès/);
  });

  it("refuses to remove the last active director", () => {
    const only: TeamMember[] = [TEAM[0], { ...TEAM[1], active: false }, TEAM[2]];
    expect(changeRefusal(only, "front_desk", "diana", { role: "front_desk", active: true })).toBe(
      "Il faut au moins une personne active à la direction.",
    );
    expect(changeRefusal(only, "front_desk", "diana", { role: "director", active: false })).toBe(
      "Il faut au moins une personne active à la direction.",
    );
    expect(changeRefusal(TEAM, "diana", "inconnu", { role: "front_desk", active: true })).toBe(
      "Ce membre n’existe plus.",
    );
  });
});

it("passwordRefusal: length and confirmation", () => {
  expect(passwordRefusal("court", "court")).toMatch(/10 caractères/);
  expect(passwordRefusal("une phrase de passe", "une phrase de pass")).toMatch(/identiques/);
  expect(passwordRefusal("une phrase de passe", "une phrase de passe")).toBeNull();
});
