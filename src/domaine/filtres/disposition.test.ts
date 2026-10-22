import { describe, expect, it } from "vitest";
import { basculer, deplacer, ecrireDisposition, lireDisposition, placer, redimensionner } from "./disposition";
import type { DefColonne } from "./filtres";

const COLONNES: DefColonne[] = [
  { id: "nom", libelle: "Élève", type: "texte" },
  { id: "age", libelle: "Âge", type: "nombre" },
  { id: "telephone", libelle: "Téléphone", type: "telephone" },
  { id: "naissance", libelle: "Naissance", type: "texte", parDefaut: false },
];
const vue = (d: ReturnType<typeof lireDisposition>) => ecrireDisposition(d).join(" ");

describe("lireDisposition", () => {
  it("sans préférence : ordre des définitions, colonnes optionnelles masquées", () => {
    expect(vue(lireDisposition(COLONNES, null))).toBe("nom age telephone -naissance");
  });

  it("garde l'ordre et la visibilité choisis ; ignore inconnus et doublons", () => {
    expect(vue(lireDisposition(COLONNES, ["telephone", "inconnue", "-age", "telephone", "naissance", "nom"]))).toBe("telephone -age naissance nom");
  });

  it("une colonne ajoutée depuis prend sa visibilité par défaut, à la fin", () => {
    expect(vue(lireDisposition(COLONNES, ["age", "nom"]))).toBe("age nom telephone -naissance");
  });

  it("au moins une colonne visible", () => {
    expect(vue(lireDisposition(COLONNES, ["-nom", "-age", "-telephone", "-naissance"]))).toBe("nom -age -telephone -naissance");
  });
});

describe("modifier", () => {
  const d = lireDisposition(COLONNES, null);
  it("déplace d'un cran, sans sortir des bords", () => {
    expect(vue(deplacer(d, "age", -1))).toBe("age nom telephone -naissance");
    expect(vue(deplacer(d, "nom", -1))).toBe(vue(d));
    expect(vue(deplacer(d, "naissance", 1))).toBe(vue(d));
  });

  it("affiche et masque, sauf la dernière colonne visible", () => {
    expect(vue(basculer(d, "naissance"))).toBe("nom age telephone naissance");
    const seule = lireDisposition(COLONNES, ["nom", "-age", "-telephone", "-naissance"]);
    expect(vue(basculer(seule, "nom"))).toBe(vue(seule));
  });
});

describe("largeurs et glisser-déposer (#102)", () => {
  it("lit et écrit les largeurs, bornées ; l'ancien format reste lu", () => {
    const d = lireDisposition(COLONNES, ["nom@180", "-age@20", "telephone@9999", "naissance@abc"]);
    expect(d).toEqual([
      { id: "nom", visible: true, largeur: 180 },
      { id: "age", visible: false, largeur: 60 },
      { id: "telephone", visible: true, largeur: 1200 },
      { id: "naissance", visible: true },
    ]);
    expect(vue(d)).toBe("nom@180 -age@60 telephone@1200 naissance");
    expect(vue(redimensionner(d, "nom", null))).toBe("nom -age@60 telephone@1200 naissance");
    expect(vue(redimensionner(d, "naissance", 123.6))).toBe("nom@180 -age@60 telephone@1200 naissance@124");
  });

  it("place une colonne devant une autre, ou à la fin", () => {
    const d = lireDisposition(COLONNES, null);
    expect(vue(placer(d, "telephone", "nom"))).toBe("telephone nom age -naissance");
    expect(vue(placer(d, "nom", null))).toBe("age telephone -naissance nom");
    expect(vue(placer(d, "nom", "nom"))).toBe(vue(d));
    expect(vue(placer(d, "inconnue", "nom"))).toBe(vue(d));
  });
});
