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
import { type PayerBalances, type PaymentRow, PAYMENT_METHODS } from "@/db/payments";
import { frenchDate } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { ButtonLink } from "../_ui/button-link";
import { CorrectPayment } from "./correct-payment";
import { isRejection, rejectionLabel, rejectionNotYet } from "@/domain/payments/rejection";
import { referenceOf } from "@/domain/payments/payment-log";

// Tables show days as « 21/10/2026 », like the payment log and the lists (#201).
const day = frenchDate;

/** Cheque number and bank, or the reference given; a reverse entry says what it is first (#272). */
const reference = (p: PaymentRow) => referenceOf(p) ?? "";

/** When the money is in: a correction or a rejection, a cheque to cash later, deposited, or cashed. */
const cashing = (p: PaymentRow, today: string) =>
  p.amountCents < 0
    ? isRejection(p)
      ? "rejet"
      : "correction"
    : p.depositedOn
      ? `remis le ${day(p.depositedOn)}`
      : p.plannedPayment && p.plannedPayment > today
        ? `le ${day(p.plannedPayment)}`
        : "encaissé";

/**
 * « Corriger » while something is left to correct, « corrigé » once it is all
 * corrected. A deposited payment is « Chèque rejeté » / « Paiement rejeté »
 * instead, dated the day the bank returned it (#253).
 */
function Correction({ payment: p, back, today }: { payment: PaymentRow; back: string; today: string }) {
  const remaining = p.amountCents - p.correctedCents;
  // A deposit dated after today: no rejection before that day, so no form whose dates could not fit.
  if (p.amountCents > 0 && remaining > 0 && p.depositedOn && rejectionNotYet(p.depositedOn, today))
    return (
      <Text span size="xs" c="dimmed">
        rejet possible à partir du {day(p.depositedOn)}
      </Text>
    );
  if (p.amountCents > 0 && remaining > 0)
    return (
      <CorrectPayment
        paymentId={p.id}
        remaining={remaining}
        back={back}
        rejection={p.depositedOn ? { label: rejectionLabel(p.method), depositedOn: p.depositedOn, today } : null}
      />
    );
  if (p.correctedCents > 0)
    return (
      <Text span size="xs" c="dimmed">
        {p.depositedOn ? "rejeté" : "corrigé"}
      </Text>
    );
  return null;
}
const OUTSIDE_CALCULATION = {
  trial: "à l’essai",
  waitlist: "en liste d’attente",
} as const;

type Props = {
  payerId: string;
  balance: PayerBalances | null;
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
  const total = balance?.total ?? null;
  const perEntity = balance?.byEntity ?? [];
  // With a single entity nothing names it (#300).
  const several = balance?.severalEntities ?? false;
  return (
    <section aria-labelledby="paiements" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        {/* Focusable: it keeps the focus when a fully corrected payment loses « Corriger ». */}
        <Title order={2} size="h5" id="paiements" tabIndex={-1}>
          Paiements
        </Title>
        <ButtonLink href={`/paiements/nouveau?payeur=${payerId}`} size="sm">
          Encaisser
        </ButtonLink>
      </div>
      {total && (
        <Paper component="dl" withBorder p="sm" className="grid grid-cols-3 gap-2">
          {perEntity.length > 0 && (
            <Text size="xs" fw={600} className="col-span-3">
              Toutes entreprises
            </Text>
          )}
          <div>
            <Text component="dt" size="xs" c="dimmed">
              Dû
            </Text>
            <Text component="dd" size="sm" fw={500} className="tabular-nums">
              {formatEuros(total.due)}
            </Text>
          </div>
          <div>
            <Text component="dt" size="xs" c="dimmed">
              Payé
            </Text>
            <Text component="dd" size="sm" fw={500} className="tabular-nums">
              {formatEuros(total.paid)}
            </Text>
          </div>
          <div>
            <Text component="dt" size="xs" c="dimmed">
              {total.remaining < 0 ? "Trop-perçu" : "Reste à payer"}
            </Text>
            <Text
              component="dd"
              size="sm"
              fw={600}
              c={total.remaining > 0 ? "red" : undefined}
              className="tabular-nums"
            >
              {formatEuros(Math.abs(total.remaining))}
            </Text>
          </div>
          {total.toCollect > 0 && (
            <Text size="xs" c="dimmed" className="col-span-3">
              Dont {formatEuros(total.toCollect)} en chèques à encaisser plus tard.
            </Text>
          )}
          {Object.entries(total.outsideCalculation).map(([status, amount]) => (
            <Text key={status} size="xs" c="dimmed" className="col-span-3">
              Inscriptions {OUTSIDE_CALCULATION[status as keyof typeof OUTSIDE_CALCULATION] ?? status} :{" "}
              {formatEuros(amount ?? 0)}, non comptées dans le dû.
            </Text>
          ))}
        </Paper>
      )}
      {/* Each business cashes into its own account (#300): what is owed to each, never netted. */}
      {perEntity.length > 0 && (
        <Paper withBorder className="overflow-x-auto">
          <Table>
            <TableCaption className="sr-only">Solde par entreprise</TableCaption>
            <TableThead>
              <TableTr>
                <TableTh>Entreprise</TableTh>
                <TableTh ta="right">Dû</TableTh>
                <TableTh ta="right">Payé</TableTh>
                <TableTh ta="right">Reste</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {perEntity.map((e) => (
                <TableTr key={e.id}>
                  <TableTd>{e.name}</TableTd>
                  <TableTd ta="right" className="tabular-nums whitespace-nowrap">
                    {formatEuros(e.balance.due)}
                  </TableTd>
                  <TableTd ta="right" className="tabular-nums whitespace-nowrap">
                    {formatEuros(e.balance.paid)}
                  </TableTd>
                  <TableTd
                    ta="right"
                    fw={600}
                    c={e.balance.remaining > 0 ? "red" : undefined}
                    className="tabular-nums whitespace-nowrap"
                  >
                    {e.balance.remaining < 0
                      ? `trop-perçu ${formatEuros(-e.balance.remaining)}`
                      : formatEuros(e.balance.remaining)}
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </Paper>
      )}
      {payments.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun paiement enregistré.
        </Text>
      ) : (
        <>
          {/* On a phone, one card per payment: nothing hides off-screen (#242). */}
          <ul aria-label="Paiements reçus" className="flex flex-col gap-2 sm:hidden">
            {payments.map((p) => (
              <Paper component="li" key={p.id} withBorder p="sm" c={p.amountCents < 0 ? "dimmed" : undefined}>
                <div className="flex items-baseline justify-between gap-2">
                  <Text size="sm" fw={500}>
                    {day(p.date)} · {PAYMENT_METHODS[p.method]}
                  </Text>
                  <Text size="sm" fw={500} className="tabular-nums whitespace-nowrap">
                    {formatEuros(p.amountCents)}
                  </Text>
                </div>
                <Text size="xs" c="dimmed">
                  {/* A correction or a rejection already says so in its reference. */}
                  {p.amountCents < 0
                    ? reference(p) || cashing(p, today)
                    : [reference(p), cashing(p, today)].filter(Boolean).join(" · ")}
                  {several && ` · ${p.entity}`}
                </Text>
                {isDirector && <Correction payment={p} back={back} today={today} />}
              </Paper>
            ))}
          </ul>
          <Paper withBorder className="hidden overflow-x-auto sm:block">
            <Table highlightOnHover>
              <TableCaption className="sr-only">Paiements reçus</TableCaption>
              <TableThead>
                <TableTr>
                  <TableTh>Reçu le</TableTh>
                  <TableTh>Moyen</TableTh>
                  <TableTh>Référence</TableTh>
                  <TableTh ta="right">Montant</TableTh>
                  <TableTh>Encaissement</TableTh>
                  {several && <TableTh>Entreprise</TableTh>}
                  {isDirector && <TableTh>Correction</TableTh>}
                </TableTr>
              </TableThead>
              <TableTbody>
                {payments.map((p) => (
                  <TableTr key={p.id} c={p.amountCents < 0 ? "dimmed" : undefined}>
                    <TableTd className="whitespace-nowrap">{day(p.date)}</TableTd>
                    <TableTd>{PAYMENT_METHODS[p.method]}</TableTd>
                    <TableTd>{reference(p) || "—"}</TableTd>
                    <TableTd ta="right" className="tabular-nums whitespace-nowrap">
                      {formatEuros(p.amountCents)}
                    </TableTd>
                    <TableTd className="whitespace-nowrap">{cashing(p, today)}</TableTd>
                    {several && <TableTd>{p.entity}</TableTd>}
                    {isDirector && (
                      <TableTd>
                        <Correction payment={p} back={back} today={today} />
                      </TableTd>
                    )}
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </Paper>
        </>
      )}
    </section>
  );
}
