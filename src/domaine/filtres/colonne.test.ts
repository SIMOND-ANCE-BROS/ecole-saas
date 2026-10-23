import { describe, expect, it } from "vitest";
import { writeColumnFilter, readColumnFilter, columnFilterSummary } from "./colonne";
import { applyFilter, type ColumnDef, type Filter, readFilter, EMPTY, toParams } from "./filtres";

const ENROLLMENT: ColumnDef = {
  id: "inscription",
  label: "Inscription",
  type: "texte",
  ifEmpty: "aucune",
  choice: ["Inscrit", "À l’essai"],
};
const AGE: ColumnDef = { id: "age", label: "Âge", type: "nombre" };
const BIRTH: ColumnDef = { id: "naissance", label: "Naissance", type: "date" };
const NAME: ColumnDef = { id: "nom", label: "Élève", type: "texte" };
const COURSE: ColumnDef = { id: "cours", label: "Cours", type: "texte" };
const COLUMNS = [ENROLLMENT, AGE, BIRTH, NAME, COURSE];
const vide: Filter = { mode: "et", conditions: [] };

describe("filtre d'une colonne (menu du titre)", () => {
  it("s'écrit en conditions de l'adresse et se relit à l'identique", () => {
    let f = writeColumnFilter(vide, ENROLLMENT, { choice: ["Inscrit", EMPTY] });
    f = writeColumnFilter(f, AGE, { min: "3", max: "17" });
    f = writeColumnFilter(f, NAME, { text: "mart" });
    const reread = readFilter(
      toParams(f).map(([, v]) => v),
      null,
      COLUMNS,
    );
    expect(toParams(reread)).toEqual([
      ["f", "inscription.parmi.Inscrit|(vide)"],
      ["f", "age.sup_egal.3"],
      ["f", "age.inf_egal.17"],
      ["f", "nom.contient.mart"],
    ]);
    expect(readColumnFilter(reread, AGE)).toEqual({ choice: null, text: "", min: "3", max: "17", otherConditions: [] });
    expect(readColumnFilter(reread, ENROLLMENT).choice).toEqual(["Inscrit", EMPTY]);
  });

  it("remplace les conditions de sa colonne seulement ; vider retire le filtre ; repasse en ET", () => {
    const f = writeColumnFilter(
      {
        mode: "ou",
        conditions: [
          { column: "nom", operator: "contient", value: "a" },
          { column: "age", operator: "egal", value: "8" },
        ],
      },
      AGE,
      { min: "", max: "" },
    );
    expect(f).toEqual({ mode: "et", conditions: [{ column: "nom", operator: "contient", value: "a" }] });
  });

  it("garde à part une condition que le menu ne sait pas montrer (ancien lien)", () => {
    const f: Filter = { mode: "et", conditions: [{ column: "nom", operator: "commence", value: "l" }] };
    expect(readColumnFilter(f, NAME)).toMatchObject({ text: "", otherConditions: [{ operator: "commence" }] });
  });

  it("résume le filtre pour sa pastille", () => {
    const r = (def: ColumnDef, f: Filter) => columnFilterSummary(def, readColumnFilter(f, def));
    expect(r(ENROLLMENT, writeColumnFilter(vide, ENROLLMENT, { choice: ["Inscrit", EMPTY] }))).toBe(
      "Inscription : Inscrit, aucune",
    );
    expect(r(AGE, writeColumnFilter(vide, AGE, { min: "3", max: "17" }))).toBe("Âge : de 3 à 17");
    expect(r(AGE, writeColumnFilter(vide, AGE, { max: "17" }))).toBe("Âge : jusqu’à 17");
    expect(r(BIRTH, writeColumnFilter(vide, BIRTH, { min: "2015-01-01" }))).toBe("Naissance : depuis le 01/01/2015");
    expect(r(NAME, writeColumnFilter(vide, NAME, { text: "mart" }))).toBe("Élève : contient « mart »");
    expect(r(NAME, vide)).toBeNull();
  });
});

describe("cases à cocher et bornes, en mémoire", () => {
  const rows = [
    { nom: "Léa", inscription: "Inscrit", cours: ["Jazz lun. 17:00"], age: 8, naissance: "2018-03-01" },
    { nom: "Hugo", inscription: "En attente", cours: [], age: 12, naissance: "2014-01-10" },
    { nom: "Inès", inscription: null, cours: ["Classique mer. 14:00", "Jazz lun. 17:00"], age: null, naissance: null },
  ];
  const cols = COLUMNS.map((c) => ({
    ...c,
    value: (l: (typeof rows)[number]) => l[c.id as keyof (typeof rows)[number]],
  }));
  const names = (def: ColumnDef, fc: Parameters<typeof writeColumnFilter>[2]) =>
    applyFilter(rows, writeColumnFilter(vide, def, fc), cols).map((l) => l.nom);

  it("parmi : une valeur cochée, la case « vide », un élément d'une liste ; accents et majuscules ignorés", () => {
    expect(names(ENROLLMENT, { choice: ["inscrit", EMPTY] })).toEqual(["Léa", "Inès"]);
    expect(names(COURSE, { choice: ["Classique mer. 14:00"] })).toEqual(["Inès"]);
    expect(names(COURSE, { choice: [EMPTY] })).toEqual(["Hugo"]);
  });

  it("bornes incluses d'un nombre et d'une date", () => {
    expect(names(AGE, { min: "8", max: "12" })).toEqual(["Léa", "Hugo"]);
    expect(names(BIRTH, { min: "2014-01-10", max: "2018-03-01" })).toEqual(["Léa", "Hugo"]);
    expect(names(BIRTH, { max: "2014-01-10" })).toEqual(["Hugo"]);
  });
});
