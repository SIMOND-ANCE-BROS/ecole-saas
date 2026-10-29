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

/**
 * `cents` × `numerator` ÷ `denominator`, rounded to the nearest cent, half a
 * cent up, in integers (no floating-point): an hourly rate for a number of
 * minutes is `prorate(rate, minutes, 60)`. Non-negative integers only.
 */
export function prorate(cents: number, numerator: number, denominator: number): number {
  if (![cents, numerator, denominator].every((n) => Number.isInteger(n) && n >= 0) || denominator === 0) {
    throw new TypeError("Montant, numérateur et dénominateur entiers positifs attendus");
  }
  return Math.floor((2 * cents * numerator + denominator) / (2 * denominator));
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

/** 123456 → « 1 234,56 € »; −1250 → « −12,50 € » with the typographic minus (U+2212). */
export function formatEuros(cents: number): string {
  // -0 (e.g. the opposite of 0) would print « −0,00 € ».
  return formatter.format(cents === 0 ? 0 : cents / 100).replace("-", "−");
}

/**
 * Input in euros (« 40 », « 40,50 », « 1 234,56 € ») → integer cents, without
 * going through a floating-point number; null if the input is not a positive amount.
 */
export function parseEuros(entry: string): number | null {
  const m = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(entry.replace(/[\s €]/g, ""));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Integer cents → text to edit in a field, read back by `parseEuros`: 3550 → « 35,50 », 3500 → « 35 ». */
export function typedEuros(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new TypeError("Montant entier positif attendu");
  const euros = Math.trunc(cents / 100);
  const rest = cents % 100;
  return rest ? `${euros},${String(rest).padStart(2, "0")}` : String(euros);
}
