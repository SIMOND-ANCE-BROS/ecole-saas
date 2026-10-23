import { describe, expect, it } from "vitest";
import { toggle, move, writeLayout, readLayout, place, resize } from "./disposition";
import type { ColumnDef } from "./filtres";

const COLUMNS: ColumnDef[] = [
  { id: "nom", label: "Élève", type: "texte" },
  { id: "age", label: "Âge", type: "nombre" },
  { id: "telephone", label: "Téléphone", type: "telephone" },
  { id: "naissance", label: "Naissance", type: "texte", byDefault: false },
];
const view = (d: ReturnType<typeof readLayout>) => writeLayout(d).join(" ");

describe("lireDisposition", () => {
  it("sans préférence : ordre des définitions, colonnes optionnelles masquées", () => {
    expect(view(readLayout(COLUMNS, null))).toBe("nom age telephone -naissance");
  });

  it("garde l'ordre et la visibilité choisis ; ignore inconnus et doublons", () => {
    expect(view(readLayout(COLUMNS, ["telephone", "inconnue", "-age", "telephone", "naissance", "nom"]))).toBe(
      "telephone -age naissance nom",
    );
  });

  it("une colonne ajoutée depuis prend sa visibilité par défaut, à la fin", () => {
    expect(view(readLayout(COLUMNS, ["age", "nom"]))).toBe("age nom telephone -naissance");
  });

  it("une colonne obligatoire (le nom) reste affichée, même masquée par une ancienne préférence", () => {
    const withName = COLUMNS.map((c) => (c.id === "nom" ? { ...c, required: true } : c));
    expect(view(readLayout(withName, ["-nom@120", "age"]))).toBe("nom@120 age telephone -naissance");
  });

  it("au moins une colonne visible", () => {
    expect(view(readLayout(COLUMNS, ["-nom", "-age", "-telephone", "-naissance"]))).toBe(
      "nom -age -telephone -naissance",
    );
  });
});

describe("modifier", () => {
  const d = readLayout(COLUMNS, null);
  it("déplace d'un cran, sans sortir des bords", () => {
    expect(view(move(d, "age", -1))).toBe("age nom telephone -naissance");
    expect(view(move(d, "nom", -1))).toBe(view(d));
    expect(view(move(d, "naissance", 1))).toBe(view(d));
  });

  it("affiche et masque, sauf la dernière colonne visible", () => {
    expect(view(toggle(d, "naissance"))).toBe("nom age telephone naissance");
    const only = readLayout(COLUMNS, ["nom", "-age", "-telephone", "-naissance"]);
    expect(view(toggle(only, "nom"))).toBe(view(only));
  });
});

describe("largeurs et glisser-déposer (#102)", () => {
  it("lit et écrit les largeurs, bornées ; l'ancien format reste lu", () => {
    const d = readLayout(COLUMNS, ["nom@180", "-age@20", "telephone@9999", "naissance@abc"]);
    expect(d).toEqual([
      { id: "nom", visible: true, width: 180 },
      { id: "age", visible: false, width: 60 },
      { id: "telephone", visible: true, width: 1200 },
      { id: "naissance", visible: true },
    ]);
    expect(view(d)).toBe("nom@180 -age@60 telephone@1200 naissance");
    expect(view(resize(d, "nom", null))).toBe("nom -age@60 telephone@1200 naissance");
    expect(view(resize(d, "naissance", 123.6))).toBe("nom@180 -age@60 telephone@1200 naissance@124");
  });

  it("place une colonne devant une autre, ou à la fin", () => {
    const d = readLayout(COLUMNS, null);
    expect(view(place(d, "telephone", "nom"))).toBe("telephone nom age -naissance");
    expect(view(place(d, "nom", null))).toBe("age telephone -naissance nom");
    expect(view(place(d, "nom", "nom"))).toBe(view(d));
    expect(view(place(d, "inconnue", "nom"))).toBe(view(d));
  });
});
