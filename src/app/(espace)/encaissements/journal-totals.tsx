import { Text } from "@mantine/core";
import { PAYMENT_METHODS, type Method } from "@/db/payments";
import type { Totals } from "@/domain/payments/deposits";
import { formatEuros } from "@/lib/money";

function Item({ term, amountCents, strong }: { term: string; amountCents: number; strong?: boolean }) {
  return (
    <div>
      <Text component="dt" size="sm" className="inline" c="dimmed">
        {term} :{" "}
      </Text>
      <Text component="dd" size="sm" fw={strong ? 600 : undefined} className="inline tabular-nums">
        {formatEuros(amountCents)}
      </Text>
    </div>
  );
}

/**
 * One line of payment-log totals (#98): the total, then each method, then refunds apart
 * (#294). `label` names the total: « Total » for the whole log, a business's name for its
 * own line (#329).
 */
export function JournalTotals({ label, totals: t }: { label: string; totals: Totals }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <Item term={label} amountCents={t.total} strong />
      {/* Always in the same order; a method netting to zero (a payment and its correction) is left out. */}
      {(Object.keys(PAYMENT_METHODS) as Method[])
        .filter((m) => (t.byMethod[m] ?? 0) !== 0)
        .map((m) => (
          <Item key={m} term={PAYMENT_METHODS[m]} amountCents={t.byMethod[m] ?? 0} />
        ))}
      {/* Money paid back to payers (#294), apart from what came in by each method. Positive
          when the period holds the cancellation of a refund made before it (#346). */}
      {t.refunded !== 0 && (
        <Item term={t.refunded > 0 ? "Remboursements annulés" : "Remboursements"} amountCents={t.refunded} />
      )}
    </dl>
  );
}
