import { repartir } from "../../lib/montant";

export type DemandeEcheancier = {
  montantCentimes: number;
  nbEcheances: number;
  /** Date de la première échéance, `YYYY-MM-DD`. */
  premiereDate: string;
  /** Écart entre deux échéances, en mois (1 par défaut). */
  intervalleMois?: number;
};

export type Echeance = { rang: number; datePrevue: string; montantCentimes: number };

/**
 * Découpe un montant en échéances. Nombre, première date et intervalle sont
 * des paramètres (propres à chaque école) ; les centimes restants vont sur la
 * première échéance (`repartir`). Chaque date est calculée depuis la première,
 * ramenée au dernier jour du mois si besoin.
 */
export function calculerEcheancier(demande: DemandeEcheancier): Echeance[] {
  const { montantCentimes, nbEcheances, premiereDate, intervalleMois = 1 } = demande;
  if (!Number.isInteger(montantCentimes) || montantCentimes <= 0) {
    throw new TypeError(`Montant invalide : ${montantCentimes}`);
  }
  if (!Number.isInteger(intervalleMois) || intervalleMois < 1) {
    throw new TypeError(`Intervalle invalide : ${intervalleMois}`);
  }
  lireDate(premiereDate);

  return repartir(montantCentimes, nbEcheances).map((montant, i) => ({
    rang: i + 1,
    datePrevue: ajouterMois(premiereDate, i * intervalleMois),
    montantCentimes: montant,
  }));
}

/** `YYYY-MM-DD` + n mois, ramené au dernier jour du mois (31 janvier + 1 → 28 ou 29 février). */
export function ajouterMois(date: string, mois: number): string {
  const { annee, mois: m, jour } = lireDate(date);
  const index = annee * 12 + (m - 1) + mois;
  const cibleAnnee = Math.floor(index / 12);
  const cibleMois = (index % 12) + 1;
  const jourCible = Math.min(jour, joursDansLeMois(cibleAnnee, cibleMois));
  return `${cibleAnnee}-${deux(cibleMois)}-${deux(jourCible)}`;
}

function lireDate(date: string) {
  const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const [annee, mois, jour] = (correspondance ?? []).slice(1).map(Number);
  if (!correspondance || mois < 1 || mois > 12 || jour < 1 || jour > joursDansLeMois(annee, mois)) {
    throw new TypeError(`Date invalide (YYYY-MM-DD attendu) : ${date}`);
  }
  return { annee, mois, jour };
}

function joursDansLeMois(annee: number, mois: number): number {
  // Jour 0 du mois suivant = dernier jour du mois, en UTC pour éviter tout effet de fuseau.
  return new Date(Date.UTC(annee, mois, 0)).getUTCDate();
}

function deux(n: number): string {
  return String(n).padStart(2, "0");
}
