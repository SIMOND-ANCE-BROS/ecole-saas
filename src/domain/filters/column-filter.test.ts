import { describe, expect, it } from "vitest";
import { writeColumnFilter, readColumnFilter, columnFilterSummary } from "./column-filter";
import { applyFilter, type ColumnDef, type Filter, readFilter, EMPTY, toParams } from "./filters";

const ENROLLMENT: ColumnDef = {
  id: "inscription",
  label: "Inscription",
  type: "text",
  ifEmpty: "aucune",
  choice: ["Inscrit", "À l’essai"],
};
const AGE: ColumnDef = { id: "age", label: "Âge", type: "number" };
const BIRTH: ColumnDef = { id: "naissance", label: "Naissance", type: "date" };
const NAME: ColumnDef = { id: "nom", label: "Élève", type: "text" };
const COURSE: ColumnDef = { id: "cours", label: "Cours", type: "text" };
const COLUMNS = [ENROLLMENT, AGE, BIRTH, NAME, COURSE];
const empty: Filter = { mode: "et", conditions: [] };

describe("column filter (header menu)", () => {
  it("is written as URL conditions and read back unchanged", () => {
    let f = writeColumnFilter(empty, ENROLLMENT, { choice: ["Inscrit", EMPTY] });
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

  it("replaces only its own column's conditions; clearing removes the filter; switches back to AND", () => {
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

  it("keeps aside a condition the menu cannot show (old link)", () => {
    const f: Filter = { mode: "et", conditions: [{ column: "nom", operator: "commence", value: "l" }] };
    expect(readColumnFilter(f, NAME)).toMatchObject({ text: "", otherConditions: [{ operator: "commence" }] });
  });

  it("summarises the filter for its badge", () => {
    const r = (def: ColumnDef, f: Filter) => columnFilterSummary(def, readColumnFilter(f, def));
    expect(r(ENROLLMENT, writeColumnFilter(empty, ENROLLMENT, { choice: ["Inscrit", EMPTY] }))).toBe(
      "Inscription : Inscrit, aucune",
    );
    expect(r(AGE, writeColumnFilter(empty, AGE, { min: "3", max: "17" }))).toBe("Âge : de 3 à 17");
    expect(r(AGE, writeColumnFilter(empty, AGE, { max: "17" }))).toBe("Âge : jusqu’à 17");
    expect(r(BIRTH, writeColumnFilter(empty, BIRTH, { min: "2015-01-01" }))).toBe("Naissance : depuis le 01/01/2015");
    expect(r(NAME, writeColumnFilter(empty, NAME, { text: "mart" }))).toBe("Élève : contient « mart »");
    expect(r(NAME, empty)).toBeNull();
  });
});

describe("checkboxes and bounds, in memory", () => {
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
    applyFilter(rows, writeColumnFilter(empty, def, fc), cols).map((l) => l.nom);

  it("among: a checked value, the « vide » box, an element of a list; ignores accents and case", () => {
    expect(names(ENROLLMENT, { choice: ["inscrit", EMPTY] })).toEqual(["Léa", "Inès"]);
    expect(names(COURSE, { choice: ["Classique mer. 14:00"] })).toEqual(["Inès"]);
    expect(names(COURSE, { choice: [EMPTY] })).toEqual(["Hugo"]);
  });

  it("inclusive bounds for a number and a date", () => {
    expect(names(AGE, { min: "8", max: "12" })).toEqual(["Léa", "Hugo"]);
    expect(names(BIRTH, { min: "2014-01-10", max: "2018-03-01" })).toEqual(["Léa", "Hugo"]);
    expect(names(BIRTH, { max: "2014-01-10" })).toEqual(["Hugo"]);
  });
});
