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

// BigInt constants: the compile target (ES2017) has no BigInt literal.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

/**
 * VAT contained in a VAT-inclusive amount at `rateBps` (2000 = 20 %):
 * incl × rate ÷ (10000 + rate), rounded to the nearest cent, half a cent away
 * from zero (#301, ADR 0006). 41500 at 2000 → 6917 (345,83 € excl. + 69,17 €).
 * Computed in BigInt: no floating-point step, whatever the amount.
 */
export function vatOfInclusive(inclCents: number, rateBps: number): number {
  if (!Number.isSafeInteger(inclCents) || !Number.isSafeInteger(rateBps) || rateBps < 0) {
    throw new TypeError("Montant entier et taux entier positif attendus");
  }
  const numerator = BigInt(Math.abs(inclCents)) * BigInt(rateBps);
  const denominator = BigInt(10000 + rateBps);
  // floor((2·n + d) / (2·d)): n / d rounded half up, on a non-negative amount.
  const vat = Number((TWO * numerator + denominator) / (TWO * denominator));
  return inclCents < 0 && vat !== 0 ? -vat : vat;
}

/**
 * Spreads `totalCents` in proportion to integer `weights` (largest remainder):
 * each share is rounded down, then the cents left over go one by one to the
 * largest remainders, ties to the lowest index. The parts always add up to the
 * total. A negative weight (a discount line) is allowed as long as the weights
 * do not add up to zero; a negative total gives the opposite of the positive
 * total's parts. In BigInt: no floating-point step.
 */
export function allocate(totalCents: number, weights: readonly number[]): number[] {
  if (!Number.isSafeInteger(totalCents) || !weights.every((w) => Number.isSafeInteger(w))) {
    throw new TypeError("Montant et poids entiers attendus");
  }
  if (weights.length === 0) throw new RangeError("Au moins un poids attendu");
  if (totalCents === 0) return weights.map(() => 0);
  if (totalCents < 0) return allocate(-totalCents, weights).map((c) => (c === 0 ? 0 : -c));
  const sum = weights.reduce((a, w) => a + BigInt(w), ZERO);
  if (sum === ZERO) throw new RangeError("Les poids s’annulent : répartition impossible");
  // Weights adding up to a negative sum: the same shares with every sign flipped.
  const divisor = sum < ZERO ? -sum : sum;
  const total = BigInt(totalCents);
  const parts = weights.map((w) => {
    const product = total * (sum < ZERO ? -BigInt(w) : BigInt(w));
    // Floor division with a non-negative remainder (BigInt division truncates toward zero).
    const truncated = product / divisor;
    const rest = product % divisor;
    return rest < ZERO ? { floor: truncated - ONE, remainder: rest + divisor } : { floor: truncated, remainder: rest };
  });
  let left = total - parts.reduce((a, p) => a + p.floor, ZERO);
  const order = parts
    .map((p, i) => ({ remainder: p.remainder, i }))
    .sort((a, b) => (a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1));
  // The parts' remainders add up to `left` × divisor, each below the divisor: `left` < number of parts.
  for (const { i } of order) {
    if (left === ZERO) break;
    parts[i].floor += ONE;
    left -= ONE;
  }
  return parts.map((p) => Number(p.floor));
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
