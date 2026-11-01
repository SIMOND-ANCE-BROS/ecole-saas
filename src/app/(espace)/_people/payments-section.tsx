import {
  Paper,
  Table,
  TableCaption,
  TableTbody,
  TableTd,
  TableTfoot,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
} from "@mantine/core";
import { type PayerBalances, type PaymentRow, PAYMENT_METHODS } from "@/db/payments";
import { familyOwed } from "@/domain/payments/balance";
import { frenchDate } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { ButtonLink } from "../_ui/button-link";
import { CorrectPayment } from "./correct-payment";
import { isRejection, rejectionLabel, rejectionNotYet } from "@/domain/payments/rejection";
import { referenceOf } from "@/domain/payments/payment-log";
import { isRefund } from "@/domain/payments/refund";
import { isRefundCancellation, refundLeftCents } from "@/domain/payments/refund-cancellation";
import { RefundPayer } from "./refund-payer";

// Tables show days as « 21/10/2026 », like the payment log and the lists (#201).
const day = frenchDate;

/** Cheque number and bank, or the reference given; a reverse entry says what it is first (#272). */
const reference = (p: PaymentRow) => referenceOf(p) ?? "";

/** A reverse entry: a correction, a rejection, a refund or a refund's cancellation (#346), not money received. */
const isReverse = (p: PaymentRow) => p.reversalKind !== null;

/** A refund at a glance (#346): paid back, cancelled in part (how much), or cancelled. */
const refundState = (p: PaymentRow) =>
  refundLeftCents({ amountCents: p.amountCents, cancelledCents: p.correctedCents }) === 0
    ? "annulé"
    : p.correctedCents > 0
      ? `remboursé, ${formatEuros(p.correctedCents)} annulés`
      : "remboursé";

/**
 * When the money is in: a refund, its cancellation, a correction or a rejection, a cheque
 * to cash later, deposited, or cashed.
 */
const cashing = (p: PaymentRow, today: string) =>
  isReverse(p)
    ? isRefund(p)
      ? refundState(p)
      : isRefundCancellation(p)
        ? "annulation"
        : isRejection(p)
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
 * instead, dated the day the bank returned it (#253). A refund is « Annuler le
 * remboursement » until it is all cancelled (#346).
 */
function Correction({
  payment: p,
  back,
  today,
  isDirector,
  canCancelRefund,
}: {
  payment: PaymentRow;
  back: string;
  today: string;
  isDirector: boolean;
  canCancelRefund: boolean;
}) {
  if (isRefund(p)) {
    if (!canCancelRefund) return null;
    const left = refundLeftCents({ amountCents: p.amountCents, cancelledCents: p.correctedCents });
    // Fully cancelled: « annulé » already shows in the « Encaissement » column (`refundState`).
    return left > 0 ? (
      <CorrectPayment paymentId={p.id} remaining={left} back={back} rejection={null} cancelsRefund />
    ) : null;
  }
  if (!isDirector || isReverse(p)) return null;
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
  /** May pay an overpayment back (#294, `mayRefund`). */
  canRefund: boolean;
  /** May cancel a refund entered by mistake (#346, `mayCancelRefund`). */
  canCancelRefund: boolean;
  today: string;
  /** The school has several seasons (#362): the balance covers them all, said in the heading. */
  allSeasons?: boolean;
};

/** A payer's payments (#97): balance, cheques to cash, payments received, corrections. */
export function PaymentsSection({
  payerId: payerId,
  balance: balance,
  payments: payments,
  back: back,
  isDirector,
  canRefund,
  canCancelRefund,
  today: today,
  allSeasons = false,
}: Props) {
  // The « Correction » column: correcting a payment, or cancelling a refund.
  const corrects = isDirector || canCancelRefund;
  const total = balance?.total ?? null;
  const perEntity = balance?.byEntity ?? [];
  // With a single entity nothing names it (#300).
  const several = balance?.severalEntities ?? false;
  const family = perEntity.length > 0 ? familyOwed(perEntity.map((e) => e.balance)) : null;
  return (
    <section aria-labelledby="paiements" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        {/* Focusable: it keeps the focus when a fully corrected payment loses « Corriger ». */}
        <Title order={2} size="h5" id="paiements" tabIndex={-1}>
          Paiements{allSeasons && " (toutes saisons)"}
        </Title>
        <ButtonLink href={`/paiements/nouveau?payeur=${payerId}`} size="sm">
          Encaisser
        </ButtonLink>
      </div>
      {total && perEntity.length === 0 && (
        <Paper component="dl" withBorder p="sm" className="grid grid-cols-3 gap-2">
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
      {/* Each business cashes into its own account (#300): one row per entity, and a total
          whose « Reste à payer » never lets an overpayment to one hide a debt to the other. */}
      {total && family && perEntity.length > 0 && (
        <Paper withBorder className="flex flex-col">
          <div className="overflow-x-auto">
            <Table>
              <TableCaption className="sr-only">Solde par entreprise</TableCaption>
              <TableThead>
                <TableTr>
                  <TableTh>Entreprise</TableTh>
                  <TableTh ta="right">Dû</TableTh>
                  <TableTh ta="right">Payé</TableTh>
                  <TableTh ta="right">Reste à payer</TableTh>
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
                        ? `Trop-perçu ${formatEuros(-e.balance.remaining)}`
                        : formatEuros(e.balance.remaining)}
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
              <TableTfoot>
                <TableTr>
                  <TableTh>Total</TableTh>
                  <TableTd ta="right" fw={600} className="tabular-nums whitespace-nowrap">
                    {formatEuros(total.due)}
                  </TableTd>
                  <TableTd ta="right" fw={600} className="tabular-nums whitespace-nowrap">
                    {formatEuros(total.paid)}
                  </TableTd>
                  <TableTd
                    ta="right"
                    fw={700}
                    c={family.owed > 0 ? "red" : undefined}
                    className="tabular-nums whitespace-nowrap"
                  >
                    {formatEuros(family.owed)}
                  </TableTd>
                </TableTr>
              </TableTfoot>
            </Table>
          </div>
          <div className="flex flex-col gap-1 px-3 pb-2">
            {family.overpaid > 0 && (
              <Text size="xs" c="dimmed">
                Trop-perçu de {formatEuros(family.overpaid)}, non déduit du reste : chaque entreprise a son propre
                compte.
              </Text>
            )}
            {total.toCollect > 0 && (
              <Text size="xs" c="dimmed">
                Dont {formatEuros(total.toCollect)} en chèques à encaisser plus tard.
              </Text>
            )}
            {Object.entries(total.outsideCalculation).map(([status, amount]) => (
              <Text key={status} size="xs" c="dimmed">
                Inscriptions {OUTSIDE_CALCULATION[status as keyof typeof OUTSIDE_CALCULATION] ?? status} :{" "}
                {formatEuros(amount ?? 0)}, non comptées dans le dû.
              </Text>
            ))}
          </div>
        </Paper>
      )}
      {/* An overpayment is paid back by the business that received it (#294): one form each. */}
      {canRefund &&
        (balance?.refunds ?? []).map((e) => (
          <div key={e.id} className="flex flex-col gap-1">
            {e.refundable > 0 && (
              <RefundPayer
                payerId={payerId}
                entity={several ? { id: e.id, name: e.name } : null}
                refundable={e.refundable}
                back={back}
                today={today}
              />
            )}
            {/* Never paid back out of a cheque that may bounce or is to be cashed later, nor
                out of an advance on an enrollment on trial or on the waitlist. */}
            {e.refundable < e.overpaid && (
              <Text size="xs" c="dimmed">
                {e.refundable > 0
                  ? `Remboursable : ${formatEuros(e.refundable)} sur un trop-perçu de ${formatEuros(e.overpaid)}`
                  : `Trop-perçu de ${formatEuros(e.overpaid)}`}
                {several ? ` (${e.name})` : ""} : {e.refundable > 0 ? "le reste attend" : "il attend"}{" "}
                {[
                  e.uncollected > 0 ? "la remise en banque des chèques reçus (ou leur date d’encaissement)" : null,
                  e.held > 0 ? "la confirmation ou l’annulation des inscriptions à l’essai ou en attente" : null,
                ]
                  .filter(Boolean)
                  .join(", et ")}
                .
              </Text>
            )}
          </div>
        ))}
      {payments.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun paiement enregistré.
        </Text>
      ) : (
        <>
          {/* On a phone, one card per payment: nothing hides off-screen (#242). */}
          <ul aria-label="Paiements reçus" className="flex flex-col gap-2 sm:hidden">
            {payments.map((p) => (
              <Paper component="li" key={p.id} withBorder p="sm" c={isReverse(p) ? "dimmed" : undefined}>
                <div className="flex items-baseline justify-between gap-2">
                  <Text size="sm" fw={500}>
                    {day(p.date)} · {PAYMENT_METHODS[p.method]}
                  </Text>
                  <Text size="sm" fw={500} className="tabular-nums whitespace-nowrap">
                    {formatEuros(p.amountCents)}
                  </Text>
                </div>
                <Text size="xs" c="dimmed">
                  {/* A reverse entry already says what it is in its reference; a refund also says what of it is cancelled. */}
                  {isReverse(p) && !isRefund(p)
                    ? reference(p) || cashing(p, today)
                    : [reference(p), cashing(p, today)].filter(Boolean).join(" · ")}
                  {several && ` · ${p.entity}`}
                </Text>
                {corrects && (
                  <Correction
                    payment={p}
                    back={back}
                    today={today}
                    isDirector={isDirector}
                    canCancelRefund={canCancelRefund}
                  />
                )}
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
                  {corrects && <TableTh>Correction</TableTh>}
                </TableTr>
              </TableThead>
              <TableTbody>
                {payments.map((p) => (
                  <TableTr key={p.id} c={isReverse(p) ? "dimmed" : undefined}>
                    <TableTd className="whitespace-nowrap">{day(p.date)}</TableTd>
                    <TableTd>{PAYMENT_METHODS[p.method]}</TableTd>
                    <TableTd>{reference(p) || "—"}</TableTd>
                    <TableTd ta="right" className="tabular-nums whitespace-nowrap">
                      {formatEuros(p.amountCents)}
                    </TableTd>
                    <TableTd className="whitespace-nowrap">
                      {cashing(p, today)}
                      {/* Under the date, not a column of its own: the table keeps its width (#300). */}
                      {several && (
                        <Text span size="xs" c="dimmed" className="block">
                          {p.entity}
                        </Text>
                      )}
                    </TableTd>
                    {corrects && (
                      <TableTd>
                        <Correction
                          payment={p}
                          back={back}
                          today={today}
                          isDirector={isDirector}
                          canCancelRefund={canCancelRefund}
                        />
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
