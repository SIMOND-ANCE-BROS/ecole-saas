/**
 * Montants en centimes entiers, taux en points de base (10000 = 100 %).
 * Ne jamais manipuler d'euros en nombre à virgule.
 */

/** Applique un taux et arrondit au centime le plus proche (arrondi commercial). */
export function applyRate(cents: number, basisPoints: number): number {
  if (!Number.isInteger(cents) || !Number.isInteger(basisPoints)) {
    throw new TypeError("Montant et taux doivent être des entiers");
  }
  const raw = (cents * basisPoints) / 10000;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

/** Répartit un montant en n échéances ; le reste des centimes va sur la première. */
export function split(cents: number, n: number): number[] {
  if (!Number.isInteger(cents) || !Number.isInteger(n) || n < 1) {
    throw new TypeError("Montant entier et nombre d'échéances ≥ 1 attendus");
  }
  const base = Math.trunc(cents / n);
  const remaining = cents - base * n;
  return Array.from({ length: n }, (_, i) => (i === 0 ? base + remaining : base));
}

const formatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

/** 123456 → « 1 234,56 € » */
export function formatEuros(cents: number): string {
  return formatter.format(cents / 100);
}

/**
 * Saisie en euros (« 40 », « 40,50 », « 1 234,56 € ») → centimes entiers, sans
 * passer par un nombre à virgule ; null si la saisie n'est pas un montant positif.
 */
export function parseEuros(saisie: string): number | null {
  const m = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(saisie.replace(/[\s €]/g, ""));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
