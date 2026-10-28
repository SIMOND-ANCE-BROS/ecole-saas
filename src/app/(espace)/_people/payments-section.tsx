import {
  Paper,
  Table,
  TableCaption,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
} from "@mantine/core";
import { type PaymentRow, PAYMENT_METHODS } from "@/db/payments";
import type { Balance } from "@/domain/payments/balance";
import { formatEuros } from "@/lib/money";
import { ButtonLink } from "../_ui/button-link";
import { CorrectPayment } from "./correct-payment";

// Tables show days as « 21/10/2026 », like the payment log and the lists (#201).
const day = (iso: string) => iso.split("-").reverse().join("/");
const OUTSIDE_CALCULATION = {
  dropped: "abandonnées",
  trial: "à l’essai",
  waitlist: "en liste d’attente",
} as const;

type Props = {
  payerId: string;
  balance: Balance | null;
  payments: PaymentRow[];
  /** Record to return to after a payment. */
  back: string;
  /** Management: may correct a payment. */
  isDirector: boolean;
  today: string;
};

/** A payer's payments (#97): balance, cheques to cash, payments received, corrections. */
export function PaymentsSection({
  payerId: payerId,
  balance: balance,
  payments: payments,
  back: back,
  isDirector,
  today: today,
}: Props) {
  return (
    <section aria-labelledby="paiements" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Title order={2} size="h5" id="paiements">
          Paiements
        </Title>
        <ButtonLink href={`/paiements/nouveau?payeur=${payerId}`} size="sm">
          Encaisser
        </ButtonLink>
      </div>
      {balance && (
        <Paper component="dl" withBorder p="sm" className="grid grid-cols-3 gap-2">
          <div>
            <Text component="dt" size="xs" c="dimmed">
              Dû
            </Text>
            <Text component="dd" size="sm" fw={500} className="tabular-nums">
              {formatEuros(balance.due)}
            </Text>
          </div>
          <div>
            <Text component="dt" size="xs" c="dimmed">
              Payé
            </Text>
            <Text component="dd" size="sm" fw={500} className="tabular-nums">
              {formatEuros(balance.paid)}
            </Text>
          </div>
          <div>
            <Text component="dt" size="xs" c="dimmed">
              {balance.remaining < 0 ? "Trop-perçu" : "Reste à payer"}
            </Text>
            <Text
              component="dd"
              size="sm"
              fw={600}
              c={balance.remaining > 0 ? "red" : undefined}
              className="tabular-nums"
            >
              {formatEuros(Math.abs(balance.remaining))}
            </Text>
          </div>
          {balance.toCollect > 0 && (
            <Text size="xs" c="dimmed" className="col-span-3">
              Dont {formatEuros(balance.toCollect)} en chèques à encaisser plus tard.
            </Text>
          )}
          {Object.entries(balance.outsideCalculation).map(([status, amount]) => (
            <Text key={status} size="xs" c="dimmed" className="col-span-3">
              Inscriptions {OUTSIDE_CALCULATION[status as keyof typeof OUTSIDE_CALCULATION] ?? status} :{" "}
              {formatEuros(amount ?? 0)}, non comptées dans le dû.
            </Text>
          ))}
        </Paper>
      )}
      {payments.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun paiement enregistré.
        </Text>
      ) : (
        <Paper withBorder className="overflow-x-auto">
          <Table highlightOnHover>
            <TableCaption className="sr-only">Paiements reçus</TableCaption>
            <TableThead>
              <TableTr>
                <TableTh>Reçu le</TableTh>
                <TableTh>Moyen</TableTh>
                <TableTh>Référence</TableTh>
                <TableTh ta="right">Montant</TableTh>
                <TableTh>Encaissement</TableTh>
                {isDirector && <TableTh>Correction</TableTh>}
              </TableTr>
            </TableThead>
            <TableTbody>
              {payments.map((p) => {
                const remaining = p.amountCents - p.correctedCents;
                return (
                  <TableTr key={p.id} c={p.amountCents < 0 ? "dimmed" : undefined}>
                    <TableTd className="whitespace-nowrap">{day(p.date)}</TableTd>
                    <TableTd>{PAYMENT_METHODS[p.method]}</TableTd>
                    <TableTd>{[p.reference, p.issuer].filter(Boolean).join(", ") || "—"}</TableTd>
                    <TableTd ta="right" className="tabular-nums whitespace-nowrap">
                      {formatEuros(p.amountCents)}
                    </TableTd>
                    <TableTd className="whitespace-nowrap">
                      {p.amountCents < 0
                        ? "correction"
                        : p.plannedPayment && p.plannedPayment > today
                          ? `le ${day(p.plannedPayment)}`
                          : "encaissé"}
                    </TableTd>
                    {isDirector && (
                      <TableTd>
                        {p.amountCents > 0 && remaining > 0 ? (
                          <CorrectPayment paymentId={p.id} remaining={remaining} back={back} />
                        ) : p.correctedCents > 0 ? (
                          <Text span size="xs" c="dimmed">
                            corrigé
                          </Text>
                        ) : null}
                      </TableTd>
                    )}
                  </TableTr>
                );
              })}
            </TableTbody>
          </Table>
        </Paper>
      )}
    </section>
  );
}
