import { describe, expect, it } from "vitest";
import { aRemettre, totaux, versCsv } from "./remises";

const p = (
  id: string,
  moyen: string,
  montantCentimes: number,
  extra: Partial<{ corrigeCentimes: number; encaissementPrevu: string | null; remiseId: string | null }> = {},
) => ({
  id,
  moyen,
  montantCentimes,
  corrigeCentimes: 0,
  encaissementPrevu: null,
  remiseId: null,
  ...extra,
});

describe("aRemettre", () => {
  it("chèques arrivés à échéance, espèces et chèques vacances, pas encore remis", () => {
    const r = aRemettre(
      [
        p("a", "cheque", 10000),
        p("b", "cheque", 10000, { encaissementPrevu: "2026-10-21" }),
        p("c", "cheque", 10000, { encaissementPrevu: "2027-01-05" }),
        p("d", "especes", 2000),
        p("e", "cheque_vacances", 5000),
        p("f", "carte", 8000),
        p("g", "cheque", 10000, { remiseId: "r1" }),
      ],
      "2026-10-21",
    );
    expect(r.cheque.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r.especes.map((x) => x.id)).toEqual(["d"]);
    expect(r.cheque_vacances.map((x) => x.id)).toEqual(["e"]);
  });

  it("ni les corrections, ni un chèque entièrement corrigé ; un chèque corrigé en partie reste à remettre", () => {
    const r = aRemettre(
      [
        p("a", "cheque", -10000),
        p("b", "cheque", 10000, { corrigeCentimes: 10000 }),
        p("c", "cheque", 10000, { corrigeCentimes: 4000 }),
      ],
      "2026-10-21",
    );
    expect(r.cheque.map((x) => x.id)).toEqual(["c"]);
  });
});

it("totaux par moyen, corrections comprises", () => {
  expect(totaux([p("a", "cheque", 10000), p("b", "cheque", -4000), p("c", "especes", 2050)])).toEqual({
    total: 8050,
    parMoyen: { cheque: 6000, especes: 2050 },
  });
});

describe("versCsv", () => {
  it("séparateur « ; », montants à virgule, dates françaises, BOM", () => {
    const csv = versCsv([
      {
        date: "2026-10-21",
        payeur: "Martin, Sophie",
        moyen: "Chèque",
        montantCentimes: 10050,
        reference: "1234567",
        emetteur: "Crédit Mutuel",
        encaissementPrevu: "2027-01-05",
        remise: null,
      },
      {
        date: "2026-10-21",
        payeur: "Petit; Anne",
        moyen: "Chèque",
        montantCentimes: -4000,
        reference: "Correction",
        emetteur: null,
        encaissementPrevu: null,
        remise: "2026-10-22",
      },
    ]);
    expect(csv.startsWith("﻿Date;Payeur;Moyen;Montant")).toBe(true);
    const lignes = csv.slice(1).split("\r\n");
    expect(lignes[1]).toBe("21/10/2026;Martin, Sophie;Chèque;100,50;1234567;Crédit Mutuel;05/01/2027;");
    expect(lignes[2]).toBe('21/10/2026;"Petit; Anne";Chèque;-40,00;Correction;;;22/10/2026');
  });

  it("une cellule texte n'est jamais lue comme une formule", () => {
    const csv = versCsv([
      {
        date: "2026-10-21",
        payeur: '=HYPERLINK("x")',
        moyen: "Chèque",
        montantCentimes: 100,
        reference: "+33",
        emetteur: "@x",
        encaissementPrevu: null,
        remise: null,
      },
    ]);
    expect(csv.split("\r\n")[1]).toBe(`21/10/2026;"'=HYPERLINK(""x"")";Chèque;1,00;'+33;'@x;;`);
  });
});
