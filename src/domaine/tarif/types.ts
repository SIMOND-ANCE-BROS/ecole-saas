/**
 * Moteur de tarif : types d'entrée et de sortie.
 * Tout ce qui est propre à une école (grille, réductions) arrive en entrée.
 * Montants en centimes, taux en points de base (1000 = 10 %).
 */

export type Public = "enfant" | "adulte" | "couple" | "etudiant";
export type Periodicite = "trimestre" | "annee" | "unite";

/** Une case de la grille (table `tarif`). */
export type LigneTarif = {
  id: string;
  public: Public;
  periodicite: Periodicite;
  /** Durées des cours de la semaine, en minutes, dans n'importe quel ordre. */
  combinaison: readonly number[];
  /** Forfait réservé à une discipline ; null = toutes disciplines. */
  disciplineId: string | null;
  prixCentimes: number;
};

/** Une règle de réduction (table `reduction`). Seul le code « fratrie » est connu du moteur. */
export type RegleReduction = {
  code: string;
  /** Exactement l'un des deux : un taux, ou un montant fixe. */
  tauxPointsBase: number | null;
  montantCentimes: number | null;
  /** Nombre minimal de danseurs éligibles du même payeur. */
  seuilDanseurs: number;
  /** Publics éligibles ; vide = tous. */
  publics: readonly Public[];
  /** false : écartée sur un forfait dont les cours relèvent d'au moins 2 disciplines. */
  cumulableMultiDisciplines: boolean;
};

export type CoursChoisi = { disciplineId: string; dureeMinutes: number };

/** Une inscription demandée par le payeur pour la saison. */
export type DemandeInscription = {
  /** Identifiant fourni par l'appelant, renvoyé tel quel dans le résultat. */
  reference: string;
  /** Un danseur, ou deux pour un couple. */
  danseurIds: readonly string[];
  public: Public;
  periodicite: Periodicite;
  cours: readonly CoursChoisi[];
};

/** Toutes les inscriptions d'un même payeur pour une saison, avec la grille de l'école. */
export type DemandeTarif = {
  grille: readonly LigneTarif[];
  reductions: readonly RegleReduction[];
  inscriptions: readonly DemandeInscription[];
};

export type DetailReduction = {
  code: string;
  statut: "appliquee" | "ecartee";
  /** 0 si écartée. */
  montantCentimes: number;
  /** Explication pour l'accueil. */
  motif: string;
};

export type ErreurTarif = {
  code: "aucun_cours" | "combinaison_absente";
  message: string;
};

export type ResultatInscription =
  | {
      reference: string;
      statut: "ok";
      ligneTarifId: string;
      /** Ex. « 45 min + 1 h 00 » */
      libelleForfait: string;
      prixBrutCentimes: number;
      reductions: DetailReduction[];
      remiseCentimes: number;
      prixNetCentimes: number;
    }
  | { reference: string; statut: "erreur"; erreur: ErreurTarif };

// ---------------------------------------------------------------------------
// Carnets de cours particuliers
// ---------------------------------------------------------------------------

/** Une case de la grille des carnets (table `tarif_carnet`). */
export type LigneTarifCarnet = {
  id: string;
  nbSeances: number;
  /** La ligne vaut pour « jusqu'à N personnes » ; la tranche commence après la ligne inférieure. */
  personnesMax: number;
  prixCentimes: number;
};

export type DemandeCarnet = { nbSeances: number; nbPersonnes: number };

export type ResultatCarnet =
  | {
      statut: "ok";
      ligneTarifCarnetId: string;
      /** Ex. « Carnet de 5 cours · 1 à 2 personnes » */
      libelle: string;
      prixCentimes: number;
    }
  | { statut: "erreur"; erreur: { code: "hors_grille"; message: string } };

export type ResultatTarif = {
  inscriptions: ResultatInscription[];
  /** Totaux des seules inscriptions tarifées. */
  totalBrutCentimes: number;
  totalRemiseCentimes: number;
  totalNetCentimes: number;
  /** false si au moins une inscription n'a pas pu être tarifée. */
  complet: boolean;
};
