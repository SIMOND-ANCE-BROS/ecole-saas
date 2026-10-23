import { describe, expect, it } from "vitest";
import { conflits, instantParis, intervalleSeance, remplacantsLibres } from "./disponibilite";

const iso = (t: number) => new Date(t).toISOString();

describe("instantParis", () => {
  it("convertit une heure de Paris en instant, été comme hiver", () => {
    expect(iso(instantParis("2026-07-01", "18:00"))).toBe("2026-07-01T16:00:00.000Z");
    expect(iso(instantParis("2026-12-01", "18:00"))).toBe("2026-12-01T17:00:00.000Z");
  });

  it("tient compte des jours de changement d’heure", () => {
    expect(iso(instantParis("2026-03-29", "10:00"))).toBe("2026-03-29T08:00:00.000Z"); // passage à l'heure d'été
    expect(iso(instantParis("2026-10-25", "10:00"))).toBe("2026-10-25T09:00:00.000Z"); // retour à l'heure d'hiver
  });
});

describe("intervalleSeance", () => {
  it("donne début et fin d’une séance", () => {
    const [debut, fin] = intervalleSeance({ date: "2026-11-04", heureDebut: "14:00", dureeMinutes: 45 });
    expect([iso(debut), iso(fin)]).toEqual(["2026-11-04T13:00:00.000Z", "2026-11-04T13:45:00.000Z"]);
  });
});

const seance = (id: string, date: string, heureDebut: string, intervenantId: string, dureeMinutes = 60) => ({
  id,
  date,
  heureDebut,
  dureeMinutes,
  intervenantId,
});
const indispo = (intervenantId: string, debut: string, fin: string) => ({
  intervenantId,
  debut: new Date(debut),
  fin: new Date(fin),
});

describe("conflits", () => {
  it("trouve les séances d’un intervenant qui chevauchent ses indisponibilités, bornes exclues", () => {
    const seances = [
      seance("a", "2026-11-04", "17:00", "camille"), // 16:00–17:00 UTC
      seance("b", "2026-11-04", "18:00", "camille"), // 17:00–18:00 UTC : commence quand l'indisponibilité finit
      seance("c", "2026-11-04", "17:00", "ines"),
    ];
    const indispos = [indispo("camille", "2026-11-04T15:30:00Z", "2026-11-04T17:00:00Z")];
    expect(conflits(seances, indispos).map((c) => c.seanceId)).toEqual(["a"]);
  });
});

describe("remplacantsLibres", () => {
  const intervenants = [
    { id: "camille", disciplines: ["Jazz"] },
    { id: "ines", disciplines: ["Éveil"] },
    { id: "lucas", disciplines: ["Jazz", "Zumba"] },
    { id: "mathis", disciplines: ["Jazz"] },
  ];

  it("classe libres d’abord, ceux qui enseignent la discipline en tête, et donne le motif des autres", () => {
    const cible = { ...seance("s", "2026-11-04", "17:00", "camille"), discipline: "Jazz" };
    const autres = [seance("x", "2026-11-04", "17:30", "lucas")];
    const indispos = [indispo("mathis", "2026-11-04T00:00:00Z", "2026-11-05T00:00:00Z")];
    expect(remplacantsLibres(cible, intervenants, autres, indispos)).toEqual([
      { id: "ines", libre: true, motif: null, enseigne: false },
      { id: "lucas", libre: false, motif: "autre séance", enseigne: true },
      { id: "mathis", libre: false, motif: "indisponible", enseigne: true },
    ]);
  });
});
