/**
 * Amounts in integer cents, rates in basis points (10000 = 100 %).
 * Never handle euros as floating-point numbers.
 */

/** Applies a rate and rounds to the nearest cent (round half away from zero). */
export function applyRate(cents: number, basisPoints: number): number {
  if (!Number.isInteger(cents) || !Number.isInteger(basisPoints)) {
    throw new TypeError("Montant et taux doivent être des entiers");
  }
  const raw = (cents * basisPoints) / 10000;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

/** Splits an amount into n installments; the leftover cents go on the first one. */
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
 * Input in euros (« 40 », « 40,50 », « 1 234,56 € ») → integer cents, without
 * going through a floating-point number; null if the input is not a positive amount.
 */
export function parseEuros(saisie: string): number | null {
  const m = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(saisie.replace(/[\s €]/g, ""));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
