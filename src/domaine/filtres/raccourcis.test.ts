import { describe, expect, it } from "vitest";
import { RACCOURCIS_ELEVES, raccourcisCours } from "./colonnes";
import type { Filtre } from "./filtres";
import { choisir, choixActif, conditionsAvancees } from "./raccourcis";

const [inscription, age] = RACCOURCIS_ELEVES;
const cours = raccourcisCours(["Jazz lun. 17:00", "Classique mer. 14:00"]);
const vide: Filtre = { mode: "et", conditions: [] };
const avancee = { colonne: "nom", operateur: "contient" as const, valeur: "dup" };

describe("boutons de filtre", () => {
  it("un choix remplace l'autre dans son groupe, les groupes se cumulent", () => {
    let f = choisir(vide, inscription, "inscrits");
    f = choisir(f, age, "mineurs");
    f = choisir(f, inscription, "sans");
    expect(choixActif(inscription, f)).toBe("sans");
    expect(choixActif(age, f)).toBe("mineurs");
    expect(f.conditions).toEqual([
      { colonne: "age", operateur: "inf", valeur: "18" },
      { colonne: "inscription", operateur: "vide", valeur: "" },
    ]);
    expect(choixActif(inscription, choisir(f, inscription, null))).toBeNull();
  });

  it("garde les filtres avancés et repasse en ET", () => {
    const f = choisir({ mode: "ou", conditions: [avancee] }, cours, "Jazz lun. 17:00");
    expect(f).toEqual({ mode: "et", conditions: [avancee, { colonne: "cours", operateur: "est", valeur: "Jazz lun. 17:00" }] });
    expect(conditionsAvancees(f, [inscription, age, cours])).toEqual([avancee]);
  });

  it("en mode OU, aucun bouton n'est actif : tout est avancé", () => {
    const f: Filtre = { mode: "ou", conditions: [{ colonne: "age", operateur: "inf", valeur: "18" }, avancee] };
    expect(choixActif(age, f)).toBeNull();
    expect(conditionsAvancees(f, [age])).toHaveLength(2);
  });
});
