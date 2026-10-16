/**
 * Montants en centimes entiers, taux en points de base (10000 = 100 %).
 * Ne jamais manipuler d'euros en nombre à virgule.
 */

/** Applique un taux et arrondit au centime le plus proche (arrondi commercial). */
export function appliquerTaux(centimes: number, pointsBase: number): number {
  if (!Number.isInteger(centimes) || !Number.isInteger(pointsBase)) {
    throw new TypeError("Montant et taux doivent être des entiers");
  }
  const brut = (centimes * pointsBase) / 10000;
  return Math.sign(brut) * Math.round(Math.abs(brut));
}

/** Répartit un montant en n échéances ; le reste des centimes va sur la première. */
export function repartir(centimes: number, n: number): number[] {
  if (!Number.isInteger(centimes) || !Number.isInteger(n) || n < 1) {
    throw new TypeError("Montant entier et nombre d'échéances ≥ 1 attendus");
  }
  const base = Math.trunc(centimes / n);
  const reste = centimes - base * n;
  return Array.from({ length: n }, (_, i) => (i === 0 ? base + reste : base));
}

const formateur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

/** 123456 → « 1 234,56 € » */
export function formaterEuros(centimes: number): string {
  return formateur.format(centimes / 100);
}
