import { describe, expect, it } from "vitest";
import type { CoursPlanning } from "@/db/planning";
import { FILTRES_VIDES, filtrerPlanning } from "./filtres";

const base: CoursPlanning = {
  id: "cours-1", jourSemaine: 1, heureDebut: "18:00", dureeMinutes: 60,
  disciplineId: "jazz", discipline: "Jazz", salleId: "salle-centre", salle: "Salle 1",
  site: "Centre", intervenantId: "prof-1", intervenant: "Intervenant fictif",
  ageMin: null, ageMax: null, niveau: null, capaciteMax: 20, inscrits: 12,
};
const cours = [base,
  { ...base, id: "cours-2", site: "Annexe", salleId: "salle-annexe", intervenantId: "prof-2" },
  { ...base, id: "cours-3", discipline: "Classique", intervenantId: "prof-2" },
];

describe("filtres du planning", () => {
  it("distingue les salles de même nom sur deux sites", () => {
    expect(filtrerPlanning(cours, { ...FILTRES_VIDES, salleId: "salle-annexe" }).map((c) => c.id)).toEqual(["cours-2"]);
  });
  it("combine site, salle, discipline et intervenant", () => {
    expect(filtrerPlanning(cours, { site: "Centre", salleId: "salle-centre", discipline: "Classique", intervenantId: "prof-2" }).map((c) => c.id)).toEqual(["cours-3"]);
  });
  it("renvoie une liste vide pour des filtres incompatibles", () => {
    expect(filtrerPlanning(cours, { ...FILTRES_VIDES, site: "Centre", salleId: "salle-annexe" })).toEqual([]);
  });
  it("retrouve tous les cours à la remise à zéro sans modifier la liste", () => {
    expect(filtrerPlanning(cours, FILTRES_VIDES)).toEqual(cours);
    expect(cours).toHaveLength(3);
  });
});
