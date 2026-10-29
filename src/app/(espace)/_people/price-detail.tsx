import { Alert, Text } from "@mantine/core";
import type { ExistingImpact } from "@/db/enrollments";
import type { EnrollmentResult } from "@/domain/tariff/types";
import { ofName } from "@/lib/french";
import { formatEuros } from "@/lib/money";

/** A priced enrollment: package, discounts (applied or set aside, with their reason) and total. */
export function PriceDetail({
  price,
  totalLabel = "Total",
  subtotal = false,
}: {
  price: Extract<EnrollmentResult, { status: "ok" }>;
  /** « Total à la confirmation » for a trial or waitlist enrollment, not due yet. */
  totalLabel?: string;
  /** One of several enrollments saved together (#299): a plain subtotal, the grand total comes after. */
  subtotal?: boolean;
}) {
  return (
    <dl className="flex flex-col gap-1">
      <div className="flex justify-between gap-2">
        <dt>Forfait {price.packageLabel}</dt>
        <dd className="tabular-nums">{formatEuros(price.grossPriceCents)}</dd>
      </div>
      {price.discounts.map((r) => (
        <Text component="div" size="sm" key={r.code} c={r.status === "rejected" ? "dimmed" : undefined}>
          <div className="flex justify-between gap-2">
            <dt>
              Réduction {r.code}
              {r.status === "rejected" ? " (écartée)" : ""}
            </dt>
            <dd className="tabular-nums">{r.status === "applied" ? `−${formatEuros(r.amountCents)}` : "—"}</dd>
          </div>
          <Text size="xs">{r.reason}</Text>
        </Text>
      ))}
      <Text
        component="div"
        size={subtotal ? "sm" : "md"}
        fw={subtotal ? 500 : 600}
        className="mt-2 flex justify-between gap-2 border-t border-bordure pt-3"
      >
        <dt>{totalLabel}</dt>
        <dd className="tabular-nums">{formatEuros(price.netPriceCents)}</dd>
      </Text>
    </dl>
  );
}

/**
 * Saved enrollments of the payer whose discount would change (#155, #284 Q2):
 * told, never re-priced on their own.
 */
export function DiscountImpacts({ impacts }: { impacts: readonly ExistingImpact[] }) {
  return impacts.map((a) => (
    <Alert key={a.reference} color="yellow" p="xs">
      <Text size="xs">
        L’inscription déjà enregistrée {ofName(a.students)} aurait une remise de {formatEuros(a.recalculatedDiscount)}{" "}
        au lieu {a.savedDeposit === 0 ? "d’aucune remise" : `de ${formatEuros(a.savedDeposit)}`} : son prix enregistré
        ne change pas, à corriger si l’école le décide.
      </Text>
    </Alert>
  ));
}
