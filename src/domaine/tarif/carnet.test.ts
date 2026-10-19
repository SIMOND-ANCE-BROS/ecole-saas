import { describe, expect, it } from "vitest";
import { tarifierCarnet } from "./carnet";
import { grilleCarnetsRibas } from "./fixtures/grille-ribas-2026";
import type { LigneTarifCarnet, ResultatCarnet } from "./types";

function ok(r: ResultatCarnet) {
  if (r.statut !== "ok") throw new Error(`attendu ok, obtenu : ${r.erreur.message}`);
  return r;
}

describe("carnets de cours particuliers (grille Ribas)", () => {
  it("tarife un cours seul pour une personne, dans la tranche « 1 à 2 personnes »", () => {
    expect(ok(tarifierCarnet(grilleCarnetsRibas, { nbSeances: 1, nbPersonnes: 1 }))).toEqual({
      statut: "ok",
      ligneTarifCarnetId: "ribas-carnet-1-2",
      libelle: "1 cours · 1 à 2 personnes",
      prixCentimes: 5000,
    });
  });

  it("applique le même prix à deux personnes", () => {
    expect(ok(tarifierCarnet(grilleCarnetsRibas, { nbSeances: 1, nbPersonnes: 2 })).prixCentimes).toBe(5000);
  });

  it("tarife un carnet de 5 cours à 3 personnes", () => {
    expect(ok(tarifierCarnet(grilleCarnetsRibas, { nbSeances: 5, nbPersonnes: 3 }))).toMatchObject({
      libelle: "5 cours · 3 personnes",
      prixCentimes: 31000,
    });
  });

  it("tarife un carnet de 10 cours à 4 personnes", () => {
    expect(ok(tarifierCarnet(grilleCarnetsRibas, { nbSeances: 10, nbPersonnes: 4 })).prixCentimes).toBe(72000);
  });

  it("renvoie au devis au-delà de la dernière tranche", () => {
    expect(tarifierCarnet(grilleCarnetsRibas, { nbSeances: 10, nbPersonnes: 5 })).toEqual({
      statut: "erreur",
      erreur: {
        code: "hors_grille",
        message: "Aucun tarif pour 10 cours à 5 personnes : prix sur devis, à saisir par l’accueil.",
      },
    });
  });

  it("signale un nombre de séances absent de la grille", () => {
    expect(tarifierCarnet(grilleCarnetsRibas, { nbSeances: 7, nbPersonnes: 1 })).toMatchObject({
      statut: "erreur",
      erreur: { code: "hors_grille" },
    });
  });
});

describe("carnets : rien n’est propre à une école", () => {
  const grille: LigneTarifCarnet[] = [
    { id: "c", nbSeances: 8, personnesMax: 6, prixCentimes: 90000 },
    { id: "a", nbSeances: 8, personnesMax: 1, prixCentimes: 40000 },
    { id: "b", nbSeances: 8, personnesMax: 3, prixCentimes: 60000 },
  ];

  it("choisit la plus petite tranche qui couvre le nombre de personnes, quel que soit l’ordre de la grille", () => {
    expect(ok(tarifierCarnet(grille, { nbSeances: 8, nbPersonnes: 2 }))).toMatchObject({
      ligneTarifCarnetId: "b",
      libelle: "8 cours · 2 à 3 personnes",
    });
    expect(ok(tarifierCarnet(grille, { nbSeances: 8, nbPersonnes: 1 })).libelle).toBe("8 cours · 1 personne");
    expect(ok(tarifierCarnet(grille, { nbSeances: 8, nbPersonnes: 5 })).libelle).toBe("8 cours · 4 à 6 personnes");
  });

  it("signale une grille vide", () => {
    expect(tarifierCarnet([], { nbSeances: 1, nbPersonnes: 1 }).statut).toBe("erreur");
  });

  it("refuse un nombre de séances ou de personnes invalide", () => {
    expect(() => tarifierCarnet(grille, { nbSeances: 8, nbPersonnes: 0 })).toThrow(TypeError);
    expect(() => tarifierCarnet(grille, { nbSeances: 2.5, nbPersonnes: 1 })).toThrow(TypeError);
  });
});
