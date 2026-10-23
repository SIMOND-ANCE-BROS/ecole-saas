import { describe, expect, it } from "vitest";
import {
  applyFilter,
  type ColumnDef,
  conditionLabel,
  readFilter,
  readSort,
  normalizeText,
  sortRows,
  toParams,
} from "./filtres";

const COLUMNS: ColumnDef[] = [
  { id: "nom", label: "Élève", type: "texte" },
  { id: "age", label: "Âge", type: "nombre" },
  { id: "responsables", label: "Responsables", type: "texte" },
  { id: "telephone", label: "Téléphone", type: "telephone" },
];

type Row = { name: string; age: number | null; guardians: string[]; telephone: string | null };
const ROWS: Row[] = [
  { name: "Léa Martin", age: 8, guardians: ["Sophie Martin"], telephone: "06 12 34 56 78" },
  { name: "Hugo Bernard", age: 12, guardians: [], telephone: null },
  { name: "Inès Moreau", age: null, guardians: ["Paul Moreau", "Anne Petit"], telephone: "07 00 00 00 01" },
];
// Column ids are data (URLs, saved preferences): map them to the row fields.
const FIELD = { nom: "name", age: "age", responsables: "guardians", telephone: "telephone" } as const;
const WITH_VALUES = COLUMNS.map((c) => ({ ...c, value: (l: Row) => l[FIELD[c.id as keyof typeof FIELD]] }));
const filter = (f: string[], mode?: string) =>
  applyFilter(ROWS, readFilter(f, mode, COLUMNS), WITH_VALUES).map((l) => l.name);

describe("lireFiltre", () => {
  it("lit colonne, opérateur et valeur ; la valeur garde ses points", () => {
    expect(readFilter(["nom.contient.st. jean", "age.vide"], "ou", COLUMNS)).toEqual({
      mode: "ou",
      conditions: [
        { column: "nom", operator: "contient", value: "st. jean" },
        { column: "age", operator: "vide", value: "" },
      ],
    });
  });

  it("ignore une colonne inconnue, un opérateur inadapté, une valeur vide ou non numérique", () => {
    expect(
      readFilter(["inconnue.contient.a", "age.contient.3", "nom.contient.", "age.sup.dix", "nom"], undefined, COLUMNS)
        .conditions,
    ).toEqual([]);
  });

  it("ignore une colonne non filtrable", () => {
    const withTariff: ColumnDef[] = [...COLUMNS, { id: "tarif", label: "Tarif", type: "texte", filterable: false }];
    expect(readFilter(["tarif.contient.30"], null, withTariff).conditions).toEqual([]);
  });

  it("ne garde que 8 conditions et revient au mode ET par défaut", () => {
    const f = readFilter(
      Array.from({ length: 12 }, () => "nom.non_vide"),
      "nimporte",
      COLUMNS,
    );
    expect(f.conditions).toHaveLength(8);
    expect(f.mode).toBe("et");
  });

  it("aller-retour avec l'adresse", () => {
    const f = readFilter(["nom.commence.lé", "telephone.non_vide"], "ou", COLUMNS);
    const p = new URLSearchParams(toParams(f));
    expect(p.toString()).toBe("f=nom.commence.l%C3%A9&f=telephone.non_vide&mode=ou");
    expect(readFilter(p.getAll("f"), p.get("mode"), COLUMNS)).toEqual(f);
  });
});

describe("appliquerFiltre", () => {
  it("ignore accents et majuscules", () => {
    expect(normalizeText("  Léa   ÉLOÏSE ")).toBe("lea eloise");
    expect(filter(["nom.contient.LEA"])).toEqual(["Léa Martin"]);
    expect(filter(["nom.est.ines moreau"])).toEqual(["Inès Moreau"]);
  });

  it("vide et non vide, sur un texte, un nombre et une liste", () => {
    expect(filter(["telephone.vide"])).toEqual(["Hugo Bernard"]);
    expect(filter(["age.vide"])).toEqual(["Inès Moreau"]);
    expect(filter(["responsables.non_vide"])).toEqual(["Léa Martin", "Inès Moreau"]);
  });

  it("compare les nombres ; une valeur absente n'est ni plus grande ni plus petite", () => {
    expect(filter(["age.sup_egal.8", "age.inf.12"])).toEqual(["Léa Martin"]);
    expect(filter(["age.different.8"])).toEqual(["Hugo Bernard", "Inès Moreau"]);
    expect(filter(["age.inf.100"])).toEqual(["Léa Martin", "Hugo Bernard"]);
  });

  it("une liste « est » X si l'un de ses éléments vaut X", () => {
    expect(filter(["responsables.est.anne petit"])).toEqual(["Inès Moreau"]);
    expect(filter(["responsables.n_est_pas.anne petit"])).toEqual(["Léa Martin", "Hugo Bernard"]);
  });

  it("téléphone : seuls les chiffres comptent", () => {
    expect(filter(["telephone.contient.12 34"])).toEqual(["Léa Martin"]);
    expect(filter(["telephone.commence.07"])).toEqual(["Inès Moreau"]);
  });

  it("ET exige toutes les conditions, OU au moins une", () => {
    expect(filter(["nom.contient.mar", "age.sup.10"])).toEqual([]);
    expect(filter(["nom.contient.mar", "age.sup.10"], "ou")).toEqual(["Léa Martin", "Hugo Bernard"]);
    expect(filter(["nom.ne_contient_pas.mar"])).toEqual(["Hugo Bernard", "Inès Moreau"]);
  });

  it("sans condition, toutes les lignes", () => {
    expect(filter([])).toHaveLength(3);
  });
});

describe("dates", () => {
  const COL: ColumnDef[] = [{ id: "naissance", label: "Naissance", type: "date" }];
  const L = [{ n: "2018-03-01" }, { n: "2014-01-10" }, { n: null }];
  const f = (x: string[]) =>
    applyFilter(L, readFilter(x, null, COL), [{ ...COL[0], value: (l: { n: string | null }) => l.n }]).map((l) => l.n);
  it("avant, après, le ; vide ; une valeur qui n'est pas une date est ignorée", () => {
    expect(f(["naissance.inf.2015-01-01"])).toEqual(["2014-01-10"]);
    expect(f(["naissance.sup.2015-01-01"])).toEqual(["2018-03-01"]);
    expect(f(["naissance.egal.2018-03-01"])).toEqual(["2018-03-01"]);
    expect(f(["naissance.vide"])).toEqual([null]);
    expect(readFilter(["naissance.inf.01/01/2015", "naissance.contient.2015"], null, COL).conditions).toEqual([]);
  });
  it("libellé lisible", () => {
    expect(conditionLabel({ column: "naissance", operator: "inf", value: "2015-01-01" }, COL)).toBe(
      "Naissance avant le 01/01/2015",
    );
  });
});

it("libelleCondition", () => {
  expect(conditionLabel({ column: "age", operator: "sup", value: "10" }, COLUMNS)).toBe("Âge > 10");
  expect(conditionLabel({ column: "nom", operator: "contient", value: "Martin" }, COLUMNS)).toBe(
    "Élève contient « Martin »",
  );
  expect(conditionLabel({ column: "telephone", operator: "vide", value: "" }, COLUMNS)).toBe("Téléphone est vide");
});

describe("tri (#107)", () => {
  const COLS: ColumnDef[] = [
    { id: "nom", label: "Nom", type: "texte" },
    { id: "age", label: "Âge", type: "nombre" },
    { id: "tarif", label: "Tarif", type: "texte", sortable: false },
  ];

  it("lit le tri de l'adresse, ignore une colonne inconnue ou non triable", () => {
    expect(readSort("age", "desc", COLS)).toEqual({ column: "age", sens: "desc" });
    expect(readSort(["nom"], undefined, COLS)).toEqual({ column: "nom", sens: "asc" });
    expect(readSort("tarif", "asc", COLS)).toBeNull();
    expect(readSort("inconnue", "asc", COLS)).toBeNull();
  });

  it("trie sans tenir compte des accents, les nombres en ordre numérique, les vides en dernier", () => {
    const rows = [
      { nom: "Émile", age: 10 },
      { nom: "eva", age: null },
      { nom: "Zoé", age: 9 },
      { nom: "", age: 30 },
    ];
    const v = (l: (typeof rows)[number], c: string) => l[c as "nom" | "age"];
    expect(sortRows(rows, { column: "nom", sens: "asc" }, v).map((l) => l.nom)).toEqual(["Émile", "eva", "Zoé", ""]);
    expect(sortRows(rows, { column: "age", sens: "desc" }, v).map((l) => l.age)).toEqual([30, 10, 9, null]);
    expect(sortRows(rows, null, v)).toBe(rows);
  });
});
