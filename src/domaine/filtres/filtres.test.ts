import { describe, expect, it } from "vitest";
import { appliquerFiltre, type DefColonne, libelleCondition, lireFiltre, normaliserTexte, versParametres } from "./filtres";

const COLONNES: DefColonne[] = [
  { id: "nom", libelle: "Élève", type: "texte" },
  { id: "age", libelle: "Âge", type: "nombre" },
  { id: "responsables", libelle: "Responsables", type: "texte" },
  { id: "telephone", libelle: "Téléphone", type: "telephone" },
];

type Ligne = { nom: string; age: number | null; responsables: string[]; telephone: string | null };
const LIGNES: Ligne[] = [
  { nom: "Léa Martin", age: 8, responsables: ["Sophie Martin"], telephone: "06 12 34 56 78" },
  { nom: "Hugo Bernard", age: 12, responsables: [], telephone: null },
  { nom: "Inès Moreau", age: null, responsables: ["Paul Moreau", "Anne Petit"], telephone: "07 00 00 00 01" },
];
const AVEC_VALEURS = COLONNES.map((c) => ({ ...c, valeur: (l: Ligne) => l[c.id as keyof Ligne] }));
const filtrer = (f: string[], mode?: string) => appliquerFiltre(LIGNES, lireFiltre(f, mode, COLONNES), AVEC_VALEURS).map((l) => l.nom);

describe("lireFiltre", () => {
  it("lit colonne, opérateur et valeur ; la valeur garde ses points", () => {
    expect(lireFiltre(["nom.contient.st. jean", "age.vide"], "ou", COLONNES)).toEqual({
      mode: "ou",
      conditions: [
        { colonne: "nom", operateur: "contient", valeur: "st. jean" },
        { colonne: "age", operateur: "vide", valeur: "" },
      ],
    });
  });

  it("ignore une colonne inconnue, un opérateur inadapté, une valeur vide ou non numérique", () => {
    expect(lireFiltre(["inconnue.contient.a", "age.contient.3", "nom.contient.", "age.sup.dix", "nom"], undefined, COLONNES).conditions).toEqual([]);
  });

  it("ne garde que 8 conditions et revient au mode ET par défaut", () => {
    const f = lireFiltre(Array.from({ length: 12 }, () => "nom.non_vide"), "nimporte", COLONNES);
    expect(f.conditions).toHaveLength(8);
    expect(f.mode).toBe("et");
  });

  it("aller-retour avec l'adresse", () => {
    const f = lireFiltre(["nom.commence.lé", "telephone.non_vide"], "ou", COLONNES);
    const p = new URLSearchParams(versParametres(f));
    expect(p.toString()).toBe("f=nom.commence.l%C3%A9&f=telephone.non_vide&mode=ou");
    expect(lireFiltre(p.getAll("f"), p.get("mode"), COLONNES)).toEqual(f);
  });
});

describe("appliquerFiltre", () => {
  it("ignore accents et majuscules", () => {
    expect(normaliserTexte("  Léa   ÉLOÏSE ")).toBe("lea eloise");
    expect(filtrer(["nom.contient.LEA"])).toEqual(["Léa Martin"]);
    expect(filtrer(["nom.est.ines moreau"])).toEqual(["Inès Moreau"]);
  });

  it("vide et non vide, sur un texte, un nombre et une liste", () => {
    expect(filtrer(["telephone.vide"])).toEqual(["Hugo Bernard"]);
    expect(filtrer(["age.vide"])).toEqual(["Inès Moreau"]);
    expect(filtrer(["responsables.non_vide"])).toEqual(["Léa Martin", "Inès Moreau"]);
  });

  it("compare les nombres ; une valeur absente n'est ni plus grande ni plus petite", () => {
    expect(filtrer(["age.sup_egal.8", "age.inf.12"])).toEqual(["Léa Martin"]);
    expect(filtrer(["age.different.8"])).toEqual(["Hugo Bernard", "Inès Moreau"]);
    expect(filtrer(["age.inf.100"])).toEqual(["Léa Martin", "Hugo Bernard"]);
  });

  it("une liste « est » X si l'un de ses éléments vaut X", () => {
    expect(filtrer(["responsables.est.anne petit"])).toEqual(["Inès Moreau"]);
    expect(filtrer(["responsables.n_est_pas.anne petit"])).toEqual(["Léa Martin", "Hugo Bernard"]);
  });

  it("téléphone : seuls les chiffres comptent", () => {
    expect(filtrer(["telephone.contient.12 34"])).toEqual(["Léa Martin"]);
    expect(filtrer(["telephone.commence.07"])).toEqual(["Inès Moreau"]);
  });

  it("ET exige toutes les conditions, OU au moins une", () => {
    expect(filtrer(["nom.contient.mar", "age.sup.10"])).toEqual([]);
    expect(filtrer(["nom.contient.mar", "age.sup.10"], "ou")).toEqual(["Léa Martin", "Hugo Bernard"]);
    expect(filtrer(["nom.ne_contient_pas.mar"])).toEqual(["Hugo Bernard", "Inès Moreau"]);
  });

  it("sans condition, toutes les lignes", () => {
    expect(filtrer([])).toHaveLength(3);
  });
});

it("libelleCondition", () => {
  expect(libelleCondition({ colonne: "age", operateur: "sup", valeur: "10" }, COLONNES)).toBe("Âge > « 10 »");
  expect(libelleCondition({ colonne: "telephone", operateur: "vide", valeur: "" }, COLONNES)).toBe("Téléphone est vide");
});
