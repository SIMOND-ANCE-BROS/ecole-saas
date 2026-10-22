import { describe, expect, it } from "vitest";
import { ecrireFiltreColonne, lireFiltreColonne, resumeFiltreColonne } from "./colonne";
import { appliquerFiltre, type DefColonne, type Filtre, lireFiltre, VIDE, versParametres } from "./filtres";

const INSCRIPTION: DefColonne = { id: "inscription", libelle: "Inscription", type: "texte", siVide: "aucune", choix: ["Inscrit", "À l’essai"] };
const AGE: DefColonne = { id: "age", libelle: "Âge", type: "nombre" };
const NAISSANCE: DefColonne = { id: "naissance", libelle: "Naissance", type: "date" };
const NOM: DefColonne = { id: "nom", libelle: "Élève", type: "texte" };
const COURS: DefColonne = { id: "cours", libelle: "Cours", type: "texte" };
const COLONNES = [INSCRIPTION, AGE, NAISSANCE, NOM, COURS];
const vide: Filtre = { mode: "et", conditions: [] };

describe("filtre d'une colonne (menu du titre)", () => {
  it("s'écrit en conditions de l'adresse et se relit à l'identique", () => {
    let f = ecrireFiltreColonne(vide, INSCRIPTION, { choix: ["Inscrit", VIDE] });
    f = ecrireFiltreColonne(f, AGE, { min: "3", max: "17" });
    f = ecrireFiltreColonne(f, NOM, { texte: "mart" });
    const relu = lireFiltre(versParametres(f).map(([, v]) => v), null, COLONNES);
    expect(versParametres(relu)).toEqual([
      ["f", "inscription.parmi.Inscrit|(vide)"],
      ["f", "age.sup_egal.3"],
      ["f", "age.inf_egal.17"],
      ["f", "nom.contient.mart"],
    ]);
    expect(lireFiltreColonne(relu, AGE)).toEqual({ choix: null, texte: "", min: "3", max: "17", autres: [] });
    expect(lireFiltreColonne(relu, INSCRIPTION).choix).toEqual(["Inscrit", VIDE]);
  });

  it("remplace les conditions de sa colonne seulement ; vider retire le filtre ; repasse en ET", () => {
    const f = ecrireFiltreColonne({ mode: "ou", conditions: [{ colonne: "nom", operateur: "contient", valeur: "a" }, { colonne: "age", operateur: "egal", valeur: "8" }] }, AGE, { min: "", max: "" });
    expect(f).toEqual({ mode: "et", conditions: [{ colonne: "nom", operateur: "contient", valeur: "a" }] });
  });

  it("garde à part une condition que le menu ne sait pas montrer (ancien lien)", () => {
    const f: Filtre = { mode: "et", conditions: [{ colonne: "nom", operateur: "commence", valeur: "l" }] };
    expect(lireFiltreColonne(f, NOM)).toMatchObject({ texte: "", autres: [{ operateur: "commence" }] });
  });

  it("résume le filtre pour sa pastille", () => {
    const r = (def: DefColonne, f: Filtre) => resumeFiltreColonne(def, lireFiltreColonne(f, def));
    expect(r(INSCRIPTION, ecrireFiltreColonne(vide, INSCRIPTION, { choix: ["Inscrit", VIDE] }))).toBe("Inscription : Inscrit, aucune");
    expect(r(AGE, ecrireFiltreColonne(vide, AGE, { min: "3", max: "17" }))).toBe("Âge : de 3 à 17");
    expect(r(AGE, ecrireFiltreColonne(vide, AGE, { max: "17" }))).toBe("Âge : jusqu’à 17");
    expect(r(NAISSANCE, ecrireFiltreColonne(vide, NAISSANCE, { min: "2015-01-01" }))).toBe("Naissance : depuis le 01/01/2015");
    expect(r(NOM, ecrireFiltreColonne(vide, NOM, { texte: "mart" }))).toBe("Élève : contient « mart »");
    expect(r(NOM, vide)).toBeNull();
  });
});

describe("cases à cocher et bornes, en mémoire", () => {
  const lignes = [
    { nom: "Léa", inscription: "Inscrit", cours: ["Jazz lun. 17:00"], age: 8, naissance: "2018-03-01" },
    { nom: "Hugo", inscription: "En attente", cours: [], age: 12, naissance: "2014-01-10" },
    { nom: "Inès", inscription: null, cours: ["Classique mer. 14:00", "Jazz lun. 17:00"], age: null, naissance: null },
  ];
  const cols = COLONNES.map((c) => ({ ...c, valeur: (l: (typeof lignes)[number]) => l[c.id as keyof (typeof lignes)[number]] }));
  const noms = (def: DefColonne, fc: Parameters<typeof ecrireFiltreColonne>[2]) => appliquerFiltre(lignes, ecrireFiltreColonne(vide, def, fc), cols).map((l) => l.nom);

  it("parmi : une valeur cochée, la case « vide », un élément d'une liste ; accents et majuscules ignorés", () => {
    expect(noms(INSCRIPTION, { choix: ["inscrit", VIDE] })).toEqual(["Léa", "Inès"]);
    expect(noms(COURS, { choix: ["Classique mer. 14:00"] })).toEqual(["Inès"]);
    expect(noms(COURS, { choix: [VIDE] })).toEqual(["Hugo"]);
  });

  it("bornes incluses d'un nombre et d'une date", () => {
    expect(noms(AGE, { min: "8", max: "12" })).toEqual(["Léa", "Hugo"]);
    expect(noms(NAISSANCE, { min: "2014-01-10", max: "2018-03-01" })).toEqual(["Léa", "Hugo"]);
    expect(noms(NAISSANCE, { max: "2014-01-10" })).toEqual(["Hugo"]);
  });
});
