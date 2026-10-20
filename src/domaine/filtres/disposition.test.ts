import { describe, expect, it } from "vitest";
import { basculer, deplacer, ecrireDisposition, lireDisposition } from "./disposition";
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
