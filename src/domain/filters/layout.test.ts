import { describe, expect, it } from "vitest";
import { toggle, move, writeLayout, readLayout, place, resize } from "./layout";
import type { ColumnDef } from "./filters";

const COLUMNS: ColumnDef[] = [
  { id: "nom", label: "Élève", type: "texte" },
  { id: "age", label: "Âge", type: "nombre" },
  { id: "telephone", label: "Téléphone", type: "telephone" },
  { id: "naissance", label: "Naissance", type: "texte", byDefault: false },
];
const view = (d: ReturnType<typeof readLayout>) => writeLayout(d).join(" ");

describe("readLayout", () => {
  it("without a preference: definition order, optional columns hidden", () => {
    expect(view(readLayout(COLUMNS, null))).toBe("nom age telephone -naissance");
  });

  it("keeps the chosen order and visibility; ignores unknown ids and duplicates", () => {
    expect(view(readLayout(COLUMNS, ["telephone", "inconnue", "-age", "telephone", "naissance", "nom"]))).toBe(
      "telephone -age naissance nom",
    );
  });

  it("a column added since then gets its default visibility, at the end", () => {
    expect(view(readLayout(COLUMNS, ["age", "nom"]))).toBe("age nom telephone -naissance");
  });

  it("a required column (the name) stays shown, even when hidden by an old preference", () => {
    const withName = COLUMNS.map((c) => (c.id === "nom" ? { ...c, required: true } : c));
    expect(view(readLayout(withName, ["-nom@120", "age"]))).toBe("nom@120 age telephone -naissance");
  });

  it("at least one visible column", () => {
    expect(view(readLayout(COLUMNS, ["-nom", "-age", "-telephone", "-naissance"]))).toBe(
      "nom -age -telephone -naissance",
    );
  });
});

describe("edit", () => {
  const d = readLayout(COLUMNS, null);
  it("moves one step, without going past the edges", () => {
    expect(view(move(d, "age", -1))).toBe("age nom telephone -naissance");
    expect(view(move(d, "nom", -1))).toBe(view(d));
    expect(view(move(d, "naissance", 1))).toBe(view(d));
  });

  it("shows and hides, except the last visible column", () => {
    expect(view(toggle(d, "naissance"))).toBe("nom age telephone naissance");
    const only = readLayout(COLUMNS, ["nom", "-age", "-telephone", "-naissance"]);
    expect(view(toggle(only, "nom"))).toBe(view(only));
  });
});

describe("widths and drag and drop (#102)", () => {
  it("reads and writes widths, within bounds; the old format is still read", () => {
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

  it("places a column before another one, or at the end", () => {
    const d = readLayout(COLUMNS, null);
    expect(view(place(d, "telephone", "nom"))).toBe("telephone nom age -naissance");
    expect(view(place(d, "nom", null))).toBe("age telephone -naissance nom");
    expect(view(place(d, "nom", "nom"))).toBe(view(d));
    expect(view(place(d, "inconnue", "nom"))).toBe(view(d));
  });
});
