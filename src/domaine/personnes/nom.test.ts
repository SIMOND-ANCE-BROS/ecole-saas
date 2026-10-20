import { describe, expect, it } from "vitest";
import { nomAffiche } from "./nom";

describe("nomAffiche", () => {
  it("donne prénom puis nom, la raison sociale d’un professionnel, ou le nom seul", () => {
    expect(nomAffiche({ nom: "Lefèvre", prenom: "Zoé", raisonSociale: null })).toBe("Zoé Lefèvre");
    expect(nomAffiche({ nom: "Durand", prenom: "Paul", raisonSociale: "CSE Ateliers" })).toBe("CSE Ateliers");
    expect(nomAffiche({ nom: "Mairie", prenom: null, raisonSociale: null })).toBe("Mairie");
  });
});
