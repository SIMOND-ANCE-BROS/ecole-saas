/**
 * VAT treatments (#301, ADR 0006): how VAT applies to a course or a lesson pack,
 * copied onto invoice lines. Prices are VAT-inclusive; VAT is taken out of the
 * sum of each treatment's lines (`vatOfInclusive`, half a cent away from zero),
 * then shared between those lines (`allocate` for the cents left over). Pure functions, no database.
 *
 * The wording of a mention is data (`vat_treatment.mention`), never written here.
 */
import { allocate, vatOfInclusive } from "../../lib/money";

/** EN 16931 categories: S (standard rate), E (exempt), O (outside the scope of VAT). */
export const VAT_CATEGORIES = ["standard", "exempt", "not_subject"] as const;
export type VatCategory = (typeof VAT_CATEGORIES)[number];

/** Categories as the school reads them. */
export const VAT_CATEGORY_LABELS = {
  standard: "Avec TVA (taux)",
  exempt: "Exonéré de TVA",
  not_subject: "Hors champ de la TVA",
} as const satisfies Record<VatCategory, string>;

/** Regimes of a business (`vat_regime`), mirrored here to keep the domain free of the schema. */
export type VatRegime = "franchise_293b" | "vat_registered" | "not_applicable";

export type VatTreatment =
  | { id: string; category: "standard"; rateBps: number }
  | { id: string; category: "exempt" | "not_subject"; mention: string };

export type VatAmounts = { inclTaxCents: number; exclTaxCents: number; vatCents: number };

/**
 * VAT of invoice lines priced VAT-inclusive. Per treatment, VAT is computed once
 * on the sum of its lines (the invoice's total); each line first gets its own
 * rounded VAT, then the cents between the two (at most one per line) are spread
 * with `allocate` in proportion to the lines' sizes. A line's VAT thus never
 * strays more than a cent from its own, even when a discount line nearly cancels
 * it; a negative discount line takes back its VAT. Each line's excl. amount is
 * incl − VAT. Lines in input order, groups in the order of their first line.
 */
export function vatBreakdown(
  lines: readonly { inclTaxCents: number; vatTreatmentId: string }[],
  treatments: readonly VatTreatment[],
): { lines: VatAmounts[]; byTreatment: (VatAmounts & { vatTreatmentId: string })[] } {
  const byId = new Map(treatments.map((t) => [t.id, t]));
  const groups = new Map<string, number[]>();
  lines.forEach((l, i) => {
    if (!Number.isSafeInteger(l.inclTaxCents)) throw new TypeError("Montant entier attendu");
    if (!byId.has(l.vatTreatmentId)) throw new RangeError(`Traitement de TVA inconnu : ${l.vatTreatmentId}`);
    groups.set(l.vatTreatmentId, [...(groups.get(l.vatTreatmentId) ?? []), i]);
  });
  const vat = lines.map(() => 0);
  const byTreatment = [...groups].map(([id, indexes]) => {
    const t = byId.get(id);
    const incl = indexes.reduce((a, i) => a + lines[i].inclTaxCents, 0);
    const total = t?.category === "standard" ? vatOfInclusive(incl, t.rateBps) : 0;
    if (t?.category === "standard") {
      for (const i of indexes) vat[i] = vatOfInclusive(lines[i].inclTaxCents, t.rateBps);
      const gap = total - indexes.reduce((a, i) => a + vat[i], 0);
      // Lines adding up to nothing but zero amounts have no gap: their weights are never all zero here.
      if (gap !== 0)
        allocate(
          gap,
          indexes.map((i) => Math.abs(lines[i].inclTaxCents)),
        ).forEach((cents, k) => (vat[indexes[k]] += cents));
    }
    return { vatTreatmentId: id, inclTaxCents: incl, exclTaxCents: incl - total, vatCents: total };
  });
  return {
    lines: lines.map((l, i) => ({
      inclTaxCents: l.inclTaxCents,
      exclTaxCents: l.inclTaxCents - vat[i],
      vatCents: vat[i],
    })),
    byTreatment,
  };
}

/**
 * Regimes under which a business charges no VAT at all: a treatment with a VAT
 * rate is refused there (an exemption or out-of-scope treatment is accepted).
 */
export const NO_VAT_CHARGED: readonly VatRegime[] = ["franchise_293b", "not_applicable"];

/** Why a business of `regime` cannot use a treatment of `category`, in French; null when it can. */
export function treatmentRefusal(regime: VatRegime, category: VatCategory): string | null {
  return category === "standard" && NO_VAT_CHARGED.includes(regime)
    ? "Cette entreprise ne facture pas de TVA (franchise en base ou non assujettie) : choisissez un traitement sans TVA."
    : null;
}

/**
 * What the database checks on a treatment, said in French before it refuses:
 * a VAT rate is above 0 % (at most 100 %); an exemption or out-of-scope
 * treatment has no rate and a mention to print on its lines.
 */
export function treatmentShapeRefusal(t: {
  category: VatCategory;
  rateBps: number;
  mention: string | null;
}): string | null {
  if (t.category === "standard")
    return Number.isInteger(t.rateBps) && t.rateBps > 0 && t.rateBps <= 10000
      ? null
      : "Taux de TVA entre 0,01 et 100 %";
  if (t.rateBps !== 0) return "Pas de taux pour une exonération ou une opération hors champ.";
  return t.mention?.trim() ? null : "Mention obligatoire : elle est imprimée sur les lignes de facture sans TVA.";
}

/** « 20 », « 5,5 », « 2.10 % » → basis points (2000, 550, 210); null when it is not a rate. */
export function parseRate(entry: string): number | null {
  const m = /^(\d{1,3})(?:[,.](\d{1,2}))?%?$/.exec(entry.replace(/\s/g, ""));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Basis points → text to edit in a field, read back by `parseRate`: 2000 → « 20 », 550 → « 5,5 ». */
export function typedRate(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const rest = String(bps % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return rest ? `${whole},${rest}` : String(whole);
}

/** 2000 → « 20 % », 550 → « 5,5 % » (non-breaking space). */
export const formatRate = (bps: number): string => `${typedRate(bps)} %`;

/**
 * Treatment proposed in the course form (UI help only, #301): the one of the
 * instructor's last course, else the business's default, else the first one the
 * business can use; a treatment the business cannot use is never proposed.
 */
export function proposedTreatment(p: {
  instructorLast: string | null;
  entityDefault: string | null;
  allowed: readonly string[];
}): string | null {
  return (
    [p.instructorLast, p.entityDefault, p.allowed[0] ?? null].find((id) => id !== null && p.allowed.includes(id)) ??
    null
  );
}
