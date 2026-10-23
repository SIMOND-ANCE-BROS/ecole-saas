import { describe, expect, it } from "vitest";
import { soldePayeur } from "./solde";

const AUJOURDHUI = "2026-10-21";

describe("soldePayeur", () => {
  it("dû = inscriptions actives et terminées + carnets ; reste = dû − payé", () => {
    const s = soldePayeur(
      [
        { statut: "active", prixNetCentimes: 32_000 },
        { statut: "terminee", prixNetCentimes: 10_050 },
      ],
      [{ prixCentimes: 12_000 }],
      [{ montantCentimes: 20_000, encaissementPrevu: null }],
      AUJOURDHUI,
    );
    expect(s).toEqual({ du: 54_050, paye: 20_000, reste: 34_050, aEncaisser: 0, horsCalcul: {} });
  });

  it("trois chèques datés : tous comptés payés, ceux à venir signalés à encaisser", () => {
    const s = soldePayeur(
      [{ statut: "active", prixNetCentimes: 30_000 }],
      [],
      [
        { montantCentimes: 10_000, encaissementPrevu: null },
        { montantCentimes: 10_000, encaissementPrevu: "2027-01-05" },
        { montantCentimes: 10_000, encaissementPrevu: "2027-04-05" },
      ],
      AUJOURDHUI,
    );
    expect(s).toMatchObject({ paye: 30_000, reste: 0, aEncaisser: 20_000 });
  });

  it("une correction (paiement négatif) réduit le payé ; un chèque arrivé à échéance n'est plus « à encaisser »", () => {
    const s = soldePayeur(
      [{ statut: "active", prixNetCentimes: 15_000 }],
      [],
      [
        { montantCentimes: 15_000, encaissementPrevu: "2026-10-21" },
        { montantCentimes: 5_000, encaissementPrevu: null },
        { montantCentimes: -5_000, encaissementPrevu: null },
      ],
      AUJOURDHUI,
    );
    expect(s).toMatchObject({ paye: 15_000, reste: 0, aEncaisser: 0 });
  });

  it("abandon, essai et liste d'attente restent hors du calcul, mais visibles (#99)", () => {
    const s = soldePayeur(
      [
        { statut: "abandon", prixNetCentimes: 20_000 },
        { statut: "essai", prixNetCentimes: 1_500 },
        { statut: "liste_attente", prixNetCentimes: 9_000 },
      ],
      [],
      [{ montantCentimes: 1_000, encaissementPrevu: null }],
      AUJOURDHUI,
    );
    expect(s).toEqual({
      du: 0,
      paye: 1_000,
      reste: -1_000,
      aEncaisser: 0,
      horsCalcul: { abandon: 20_000, essai: 1_500, liste_attente: 9_000 },
    });
  });
});
