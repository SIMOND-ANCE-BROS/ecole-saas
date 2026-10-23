import { describe, expect, it } from "vitest";
import { type TeamMember, changeRefusal, passwordRefusal } from "./rules";

const TEAM: TeamMember[] = [
  { id: "diana", role: "direction", active: true },
  { id: "anthony", role: "direction", active: true },
  { id: "accueil", role: "accueil", active: true },
];

describe("refusChangement", () => {
  it("permet de changer le rôle ou l'activité d'un autre membre", () => {
    expect(changeRefusal(TEAM, "diana", "accueil", { role: "direction", active: true })).toBeNull();
    expect(changeRefusal(TEAM, "diana", "anthony", { role: "direction", active: false })).toBeNull();
  });

  it("refuse de modifier son propre accès", () => {
    expect(changeRefusal(TEAM, "diana", "diana", { role: "accueil", active: true })).toMatch(/propre accès/);
  });

  it("refuse de retirer la dernière personne active de la direction", () => {
    const only: TeamMember[] = [TEAM[0], { ...TEAM[1], active: false }, TEAM[2]];
    expect(changeRefusal(only, "accueil", "diana", { role: "accueil", active: true })).toBe(
      "Il faut au moins une personne active à la direction.",
    );
    expect(changeRefusal(only, "accueil", "diana", { role: "direction", active: false })).toBe(
      "Il faut au moins une personne active à la direction.",
    );
    expect(changeRefusal(TEAM, "diana", "inconnu", { role: "accueil", active: true })).toBe("Ce membre n’existe plus.");
  });
});

it("refusMotDePasse : longueur et confirmation", () => {
  expect(passwordRefusal("court", "court")).toMatch(/10 caractères/);
  expect(passwordRefusal("une phrase de passe", "une phrase de pass")).toMatch(/identiques/);
  expect(passwordRefusal("une phrase de passe", "une phrase de passe")).toBeNull();
});
