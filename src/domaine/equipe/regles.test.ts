import { describe, expect, it } from "vitest";
import { type MembreEquipe, refusChangement, refusMotDePasse } from "./regles";

const EQUIPE: MembreEquipe[] = [
  { id: "diana", role: "direction", actif: true },
  { id: "anthony", role: "direction", actif: true },
  { id: "accueil", role: "accueil", actif: true },
];

describe("refusChangement", () => {
  it("permet de changer le rôle ou l'activité d'un autre membre", () => {
    expect(refusChangement(EQUIPE, "diana", "accueil", { role: "direction", actif: true })).toBeNull();
    expect(refusChangement(EQUIPE, "diana", "anthony", { role: "direction", actif: false })).toBeNull();
  });

  it("refuse de modifier son propre accès", () => {
    expect(refusChangement(EQUIPE, "diana", "diana", { role: "accueil", actif: true })).toMatch(/propre accès/);
  });

  it("refuse de retirer la dernière personne active de la direction", () => {
    const seule: MembreEquipe[] = [EQUIPE[0], { ...EQUIPE[1], actif: false }, EQUIPE[2]];
    expect(refusChangement(seule, "accueil", "diana", { role: "accueil", actif: true })).toBe("Il faut au moins une personne active à la direction.");
    expect(refusChangement(seule, "accueil", "diana", { role: "direction", actif: false })).toBe("Il faut au moins une personne active à la direction.");
    expect(refusChangement(EQUIPE, "diana", "inconnu", { role: "accueil", actif: true })).toBe("Ce membre n’existe plus.");
  });
});

it("refusMotDePasse : longueur et confirmation", () => {
  expect(refusMotDePasse("court", "court")).toMatch(/10 caractères/);
  expect(refusMotDePasse("une phrase de passe", "une phrase de pass")).toMatch(/identiques/);
  expect(refusMotDePasse("une phrase de passe", "une phrase de passe")).toBeNull();
});
