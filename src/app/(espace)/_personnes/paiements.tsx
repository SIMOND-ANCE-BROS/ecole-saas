import Link from "next/link";
import { type PaymentRow, MOYENS } from "@/db/paiements";
import type { Balance } from "@/domaine/encaissement/solde";
import { formatEuros } from "@/lib/montant";
import { CorrectPayment } from "./corriger";

const shortDate = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const day = (iso: string) => shortDate.format(new Date(`${iso}T00:00:00Z`));
const OUTSIDE_CALCULATION = {
  abandon: "abandonnées",
  essai: "à l’essai",
  liste_attente: "en liste d’attente",
} as const;

type Props = {
  payerId: string;
  balance: Balance | null;
  payments: PaymentRow[];
  /** Fiche où revenir après un encaissement. */
  back: string;
  /** Direction : peut corriger un paiement. */
  direction: boolean;
  today: string;
};

/** Paiements d'un payeur (#97) : solde, chèques à encaisser, règlements reçus, corrections. */
export function PaymentsSection({
  payerId: payerId,
  balance: balance,
  payments: payments,
  back: back,
  direction,
  today: today,
}: Props) {
  return (
    <section aria-labelledby="paiements" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="paiements" className="text-base font-semibold">
          Paiements
        </h2>
        <Link href={`/paiements/nouveau?payeur=${payerId}`} className="bouton-principal">
          Encaisser
        </Link>
      </div>
      {balance && (
        <dl className="panneau grid grid-cols-3 gap-2 p-3 text-sm">
          <div>
            <dt className="text-xs text-doux">Dû</dt>
            <dd className="font-medium tabular-nums">{formatEuros(balance.du)}</dd>
          </div>
          <div>
            <dt className="text-xs text-doux">Payé</dt>
            <dd className="font-medium tabular-nums">{formatEuros(balance.paye)}</dd>
          </div>
          <div>
            <dt className="text-xs text-doux">{balance.remaining < 0 ? "Trop-perçu" : "Reste à payer"}</dt>
            <dd className={`font-semibold tabular-nums ${balance.remaining > 0 ? "text-alerte-texte" : ""}`}>
              {formatEuros(Math.abs(balance.remaining))}
            </dd>
          </div>
          {balance.toCollect > 0 && (
            <p className="col-span-3 text-xs text-doux">
              Dont {formatEuros(balance.toCollect)} en chèques à encaisser plus tard.
            </p>
          )}
          {Object.entries(balance.outsideCalculation).map(([status, amount]) => (
            <p key={status} className="col-span-3 text-xs text-doux">
              Inscriptions {OUTSIDE_CALCULATION[status as keyof typeof OUTSIDE_CALCULATION] ?? status} :{" "}
              {formatEuros(amount ?? 0)}, non comptées dans le dû.
            </p>
          ))}
        </dl>
      )}
      {payments.length === 0 ? (
        <p className="text-sm text-doux">Aucun paiement enregistré.</p>
      ) : (
        <div className="panneau overflow-x-auto">
          <table className="tableau">
            <caption className="sr-only">Paiements reçus</caption>
            <thead>
              <tr>
                <th>Reçu le</th>
                <th>Moyen</th>
                <th>Référence</th>
                <th className="text-right">Montant</th>
                <th>Encaissement</th>
                {direction && <th>Correction</th>}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const remaining = p.amountCents - p.correctedCents;
                return (
                  <tr key={p.id} className={p.amountCents < 0 ? "text-doux" : ""}>
                    <td className="whitespace-nowrap">{day(p.date)}</td>
                    <td>{MOYENS[p.method]}</td>
                    <td>{[p.reference, p.issuer].filter(Boolean).join(", ") || "—"}</td>
                    <td className="text-right tabular-nums whitespace-nowrap">{formatEuros(p.amountCents)}</td>
                    <td className="whitespace-nowrap">
                      {p.amountCents < 0
                        ? "correction"
                        : p.plannedPayment && p.plannedPayment > today
                          ? `le ${day(p.plannedPayment)}`
                          : "encaissé"}
                    </td>
                    {direction && (
                      <td>
                        {p.amountCents > 0 && remaining > 0 ? (
                          <CorrectPayment paymentId={p.id} remaining={remaining} back={back} />
                        ) : p.correctedCents > 0 ? (
                          <span className="text-xs text-doux">corrigé</span>
                        ) : null}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
