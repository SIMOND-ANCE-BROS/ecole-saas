import { describe, expect, it } from "vitest";
import { formaterEuros } from "../../lib/montant";
import { calculerTarif } from "./calculer";
import { fratrieRibas, grilleRibas, ZUMBA } from "./fixtures/grille-ribas-2026";
import type { CoursChoisi, DemandeInscription, LigneTarif, RegleReduction, ResultatInscription } from "./types";

const CLASSIQUE = "discipline-classique";
const JAZZ = "discipline-jazz";
const SALSA = "discipline-salsa";

let n = 0;
/** Inscription d'un danseur ; cours en minutes, discipline classique par défaut. */
function inscription(
  partiel: Partial<Omit<DemandeInscription, "cours">> & { cours?: readonly (CoursChoisi | number)[] },
): DemandeInscription {
  n += 1;
  const cours = (partiel.cours ?? [60]).map((c) =>
    typeof c === "number" ? { disciplineId: CLASSIQUE, dureeMinutes: c } : c,
  );
  return {
    reference: `i${n}`,
    danseurIds: [`d${n}`],
    public: "enfant",
    periodicite: "trimestre",
    ...partiel,
    cours,
  };
}

function ribas(...inscriptions: DemandeInscription[]) {
  return calculerTarif({ grille: grilleRibas, reductions: [fratrieRibas], inscriptions });
}

function ok(r: ResultatInscription) {
  if (r.statut !== "ok") throw new Error(`attendu ok, obtenu : ${r.erreur.message}`);
  return r;
}

const fratrie = (r: ResultatInscription) => ok(r).reductions.find((d) => d.code === "fratrie");

describe("choix du forfait (grille Ribas)", () => {
  it("tarife un enfant à 1 h 00 par semaine au trimestre", () => {
    const [r] = ribas(inscription({ cours: [60] })).inscriptions;
    expect(ok(r)).toMatchObject({ prixBrutCentimes: 11000, libelleForfait: "1 h 00", prixNetCentimes: 11000 });
  });

  it("ignore l’ordre de saisie des cours", () => {
    const [r] = ribas(inscription({ cours: [60, 45] })).inscriptions;
    expect(ok(r)).toMatchObject({ prixBrutCentimes: 16500, libelleForfait: "45 min + 1 h 00" });
  });

  it("distingue deux combinaisons de même durée totale (2 h 30)", () => {
    const [a, b] = ribas(inscription({ cours: [45, 45, 60] }), inscription({ cours: [60, 90] })).inscriptions;
    expect(ok(a).prixBrutCentimes).toBe(19500);
    expect(ok(b).prixBrutCentimes).toBe(22000);
  });

  it("applique la périodicité annuelle", () => {
    const [r] = ribas(inscription({ cours: [90, 90], periodicite: "annee" })).inscriptions;
    expect(ok(r).prixBrutCentimes).toBe(64500);
  });

  it("tarife un adulte sur 3 cours", () => {
    const [r] = ribas(inscription({ public: "adulte", cours: [60, 90, 60] })).inscriptions;
    expect(ok(r)).toMatchObject({ prixBrutCentimes: 28500, libelleForfait: "1 h 00 + 1 h 00 + 1 h 30" });
  });

  it("tarife un couple au prix du couple", () => {
    const [r] = ribas(
      inscription({ public: "couple", danseurIds: ["a", "b"], periodicite: "annee", cours: [90] }),
    ).inscriptions;
    expect(ok(r).prixBrutCentimes).toBe(75500);
  });

  it("tarife un étudiant", () => {
    const [r] = ribas(inscription({ public: "etudiant", periodicite: "annee", cours: [60] })).inscriptions;
    expect(ok(r).prixBrutCentimes).toBe(29000);
  });

  it("tarife un cours à l’unité", () => {
    const [r] = ribas(inscription({ public: "adulte", periodicite: "unite", cours: [90] })).inscriptions;
    expect(ok(r).prixBrutCentimes).toBe(2000);
  });
});

describe("forfait réservé à une discipline", () => {
  const zumba = (duree: number) => ({ disciplineId: ZUMBA, dureeMinutes: duree });

  it("prend la ligne Zumba quand tous les cours sont de la Zumba", () => {
    const [r] = ribas(
      inscription({ public: "adulte", periodicite: "annee", cours: [zumba(60), zumba(60)] }),
    ).inscriptions;
    expect(ok(r).prixBrutCentimes).toBe(43000);
  });

  it("prend la ligne générale quand les disciplines sont mélangées", () => {
    const [r] = ribas(
      inscription({
        public: "adulte",
        periodicite: "annee",
        cours: [zumba(60), { disciplineId: SALSA, dureeMinutes: 60 }],
      }),
    ).inscriptions;
    expect(ok(r).prixBrutCentimes).toBe(52000);
  });

  it("revient à la ligne générale si la discipline n’a pas de ligne pour cette périodicité", () => {
    const [r] = ribas(inscription({ public: "adulte", cours: [zumba(60), zumba(60)] })).inscriptions;
    expect(ok(r).prixBrutCentimes).toBe(20500);
  });
});

describe("inscriptions impossibles à tarifer", () => {
  it("signale une combinaison absente de la grille, sans bloquer les autres", () => {
    const resultat = ribas(inscription({ cours: [45, 45] }), inscription({ cours: [60] }));
    expect(resultat.inscriptions[0]).toMatchObject({
      statut: "erreur",
      erreur: { code: "combinaison_absente" },
    });
    const [erreur] = resultat.inscriptions;
    if (erreur.statut !== "erreur") throw new Error("attendu erreur");
    expect(erreur.erreur.message).toBe(
      "Aucun forfait « enfant » au trimestre pour 45 min + 45 min : prix à saisir par l’accueil.",
    );
    // Totaux des seules inscriptions tarifées ; l'enfant à saisir compte pour la fratrie de l'autre.
    expect(resultat).toMatchObject({
      complet: false,
      totalBrutCentimes: 11000,
      totalRemiseCentimes: 1100,
      totalNetCentimes: 9900,
    });
  });

  it("signale un étudiant sur deux cours (absent de la grille)", () => {
    const [r] = ribas(inscription({ public: "etudiant", cours: [60, 60] })).inscriptions;
    expect(r).toMatchObject({ statut: "erreur", erreur: { code: "combinaison_absente" } });
  });

  it("signale une inscription sans cours", () => {
    const [r] = ribas(inscription({ cours: [] })).inscriptions;
    expect(r).toMatchObject({ statut: "erreur", erreur: { code: "aucun_cours" } });
  });
});

describe("réduction fratrie (Ribas : -10 % dès 2 enfants, non cumulable avec 2 disciplines)", () => {
  it("applique -10 % à chacun de deux enfants", () => {
    const resultat = ribas(inscription({ cours: [60] }), inscription({ cours: [45] }));
    const [a, b] = resultat.inscriptions;
    expect(fratrie(a)).toEqual({
      code: "fratrie",
      statut: "appliquee",
      montantCentimes: 1100,
      motif: "2 enfants du même payeur : -10 %",
    });
    expect(ok(b)).toMatchObject({ remiseCentimes: 850, prixNetCentimes: 7650 });
    expect(resultat).toMatchObject({
      complet: true,
      totalBrutCentimes: 19500,
      totalRemiseCentimes: 1950,
      totalNetCentimes: 17550,
    });
  });

  it("l’écarte pour un enfant seul", () => {
    const [r] = ribas(inscription({ cours: [60] })).inscriptions;
    expect(fratrie(r)).toEqual({
      code: "fratrie",
      statut: "ecartee",
      montantCentimes: 0,
      motif: "1 enfant du même payeur, 2 requis",
    });
    expect(ok(r).prixNetCentimes).toBe(11000);
  });

  it("l’applique aux trois enfants d’une fratrie de trois", () => {
    const resultat = ribas(inscription({}), inscription({}), inscription({}));
    expect(resultat.inscriptions.map((r) => fratrie(r)?.statut)).toEqual(["appliquee", "appliquee", "appliquee"]);
    expect(fratrie(resultat.inscriptions[2])?.motif).toBe("3 enfants du même payeur : -10 %");
    expect(resultat.totalNetCentimes).toBe(3 * 9900);
  });

  it("ne compte pas un adulte du même payeur, et l’écarte pour lui", () => {
    const [enfant, adulte] = ribas(inscription({}), inscription({ public: "adulte" })).inscriptions;
    expect(fratrie(enfant)?.statut).toBe("ecartee");
    expect(fratrie(adulte)).toMatchObject({ statut: "ecartee", motif: "Réservée au public enfant" });
  });

  it("l’écarte pour un couple", () => {
    const [r] = ribas(inscription({ public: "couple", danseurIds: ["a", "b"] })).inscriptions;
    expect(fratrie(r)?.statut).toBe("ecartee");
  });

  it("l’écarte sur un forfait 2 disciplines, mais l’enfant compte pour ses frères et sœurs", () => {
    const [deuxDisciplines, frere] = ribas(
      inscription({
        cours: [
          { disciplineId: CLASSIQUE, dureeMinutes: 60 },
          { disciplineId: JAZZ, dureeMinutes: 60 },
        ],
      }),
      inscription({ cours: [60] }),
    ).inscriptions;
    expect(fratrie(deuxDisciplines)).toEqual({
      code: "fratrie",
      statut: "ecartee",
      montantCentimes: 0,
      motif: "Non cumulable avec un forfait 2 disciplines",
    });
    expect(ok(deuxDisciplines).prixNetCentimes).toBe(18500);
    expect(fratrie(frere)?.statut).toBe("appliquee");
  });

  it("l’applique à deux cours de la même discipline", () => {
    const [deuxCoursJazz] = ribas(
      inscription({
        cours: [
          { disciplineId: JAZZ, dureeMinutes: 60 },
          { disciplineId: JAZZ, dureeMinutes: 60 },
        ],
      }),
      inscription({}),
    ).inscriptions;
    expect(fratrie(deuxCoursJazz)?.statut).toBe("appliquee");
  });

  it("compte une seule fois un enfant inscrit deux fois", () => {
    const [t1, t2] = ribas(inscription({ danseurIds: ["x"] }), inscription({ danseurIds: ["x"] })).inscriptions;
    expect(fratrie(t1)?.statut).toBe("ecartee");
    expect(fratrie(t2)?.statut).toBe("ecartee");
  });

  it("compte un enfant dont le forfait est à saisir à la main", () => {
    const [, frere] = ribas(inscription({ cours: [45, 45] }), inscription({})).inscriptions;
    expect(fratrie(frere)?.statut).toBe("appliquee");
  });
});

describe("rien n’est propre à une école", () => {
  const grille: LigneTarif[] = [
    { id: "a", public: "adulte", periodicite: "annee", combinaison: [75], disciplineId: null, prixCentimes: 12345 },
    { id: "b", public: "adulte", periodicite: "unite", combinaison: [75], disciplineId: null, prixCentimes: 1500 },
  ];
  const regle = (partiel: Partial<RegleReduction>): RegleReduction => ({
    code: "fratrie",
    tauxPointsBase: null,
    montantCentimes: null,
    seuilDanseurs: 1,
    publics: [],
    cumulableMultiDisciplines: true,
    ...partiel,
  });
  const adulte = (periodicite: "annee" | "unite" = "annee") =>
    inscription({ public: "adulte", periodicite, cours: [75] });

  it("arrondit chaque réduction au centime, et le total est la somme des lignes", () => {
    const resultat = calculerTarif({
      grille,
      reductions: [regle({ tauxPointsBase: 1000, seuilDanseurs: 2 })],
      inscriptions: [adulte(), adulte()],
    });
    expect(resultat.inscriptions.map((r) => ok(r).remiseCentimes)).toEqual([1235, 1235]);
    expect(resultat).toMatchObject({ totalRemiseCentimes: 2470, totalNetCentimes: 2 * 12345 - 2470 });
    expect(fratrie(resultat.inscriptions[0])?.motif).toBe("2 danseurs du même payeur : -10 %");
  });

  it("applique un montant fixe, plafonné au prix", () => {
    const [annuel, unite] = calculerTarif({
      grille,
      reductions: [regle({ montantCentimes: 2000 })],
      inscriptions: [adulte(), adulte("unite")],
    }).inscriptions;
    expect(ok(annuel)).toMatchObject({ remiseCentimes: 2000, prixNetCentimes: 10345 });
    expect(fratrie(annuel)?.motif).toBe(`2 danseurs du même payeur : -${formaterEuros(2000)}`);
    expect(ok(unite)).toMatchObject({ remiseCentimes: 1500, prixNetCentimes: 0 });
  });

  it("écarte un type de réduction inconnu du moteur", () => {
    const [r] = calculerTarif({
      grille,
      reductions: [regle({ code: "parrainage", tauxPointsBase: 500 })],
      inscriptions: [adulte()],
    }).inscriptions;
    expect(ok(r).reductions).toEqual([
      {
        code: "parrainage",
        statut: "ecartee",
        montantCentimes: 0,
        motif: "Type de réduction non pris en charge par le moteur de tarif",
      },
    ]);
  });

  it("refuse une réduction qui n’a ni taux ni montant, ou les deux", () => {
    const calcul = (r: RegleReduction) => () => calculerTarif({ grille, reductions: [r], inscriptions: [adulte()] });
    expect(calcul(regle({}))).toThrow("Réduction « fratrie » : renseigner un taux ou un montant, pas les deux");
    expect(calcul(regle({ tauxPointsBase: 1000, montantCentimes: 500 }))).toThrow(TypeError);
  });
});
