"use client";

import { Button, Group, Input, Text } from "@mantine/core";
import { unstable_rethrow, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState, useTransition } from "react";
import { rejectionDateRefusal } from "@/domain/payments/rejection";
import { NOT_SAVED } from "@/lib/action-result";
import { frenchDate } from "@/lib/dates";
import { formatEuros, parseEuros, typedEuros } from "@/lib/money";
import { cancelRefund, correct } from "../paiements/actions";
import { DateField, refusedDateField } from "../_ui/date-field";
import { EscapeCancelsForm } from "../_ui/escape-asks";

/** Heading of the payments section (`payments-section.tsx`), focused when a fully corrected payment loses its button. */
const PAYMENTS_HEADING = "paiements";

/** Why a typed correction cannot be saved, or null. */
function refusalOf(amount: string, remaining: number): string | null {
  const cents = parseEuros(amount);
  if (amount.trim() === "" || cents === 0 || (cents !== null && cents < 0)) return "Indiquez un montant supérieur à 0";
  if (cents === null) return "Montant non reconnu";
  if (cents > remaining) return "Montant trop élevé";
  return null;
}

/** A payment already in a bank deposit: rejected (bounced cheque) rather than corrected (#253). */
export type Rejection = {
  /** « Chèque rejeté » or « Paiement rejeté ». */
  label: string;
  /** Day of the bank deposit: the rejection cannot come before it. */
  depositedOn: string;
  today: string;
};

/**
 * Correcting a payment (management): a payment is never modified, a negative
 * payment is entered instead, at most the amount not yet corrected. A payment
 * already deposited is recorded as rejected, for all that is left, on the day
 * the bank returned it; its deposit slip stays as printed and the amount is
 * due again (#253). A refund entered by mistake is cancelled the same way, with
 * a positive entry instead (`cancelsRefund`, #346). Each opening of the form sends
 * with its own key: a retry after a lost response records nothing twice (#260).
 */
export function CorrectPayment({
  paymentId,
  remaining,
  back,
  rejection,
  cancelsRefund = false,
}: {
  paymentId: string;
  /** What is left to correct, or of a refund what is not cancelled yet, as a positive amount. */
  remaining: number;
  back: string;
  rejection: Rejection | null;
  /** The payment is a refund: the form cancels it (management, #346). */
  cancelsRefund?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [amount, setAmount] = useState(typedEuros(remaining));
  const [rejectedOn, setRejectedOn] = useState(rejection?.today ?? "");
  // The refusal shows on Enter or when leaving the field, not while typing « 12, ».
  const [shown, setShown] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  const opener = useRef<HTMLButtonElement>(null);
  // Closed by « Fermer », Escape or a saved correction: the focus goes back to the opening button, not to the page.
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (closed && !open) opener.current?.focus();
  }, [closed, open]);
  const close = () => {
    setOpen(false);
    setClosed(true);
  };
  if (!open) {
    return (
      <Button
        ref={opener}
        variant="subtle"
        size="compact-xs"
        onClick={() => {
          setClosed(false);
          setShown(false);
          setMessage(null);
          setRejectedOn(rejection?.today ?? "");
          // « Abandonner » or « Fermer » drops what was typed: each opening starts from all that is left.
          setAmount(typedEuros(remaining));
          setKey(crypto.randomUUID());
          setOpen(true);
        }}
      >
        {rejection ? rejection.label : cancelsRefund ? "Annuler le remboursement" : "Corriger"}
      </Button>
    );
  }
  // A rejection is of everything left (a bank rejects a whole cheque): nothing to type.
  const cents = rejection ? remaining : parseEuros(amount);
  const refusal = rejection ? null : refusalOf(amount, remaining);
  const dateRefusal = rejection
    ? rejectedOn === ""
      ? "Indiquez la date du rejet"
      : rejectionDateRefusal(rejectedOn, rejection.depositedOn, rejection.today)
    : null;
  const id = `correction-${paymentId}`;
  const buttons = (saveLabel: string, props: { mb?: number } = {}, focusSave = false): ReactNode => (
    <>
      <Button type="submit" variant="default" size="compact-xs" loading={sending} autoFocus={focusSave} {...props}>
        {saveLabel}
      </Button>
      <Button variant="subtle" size="compact-xs" onClick={close} {...props}>
        Fermer
      </Button>
    </>
  );
  return (
    // Escape with the calendar open closes only the calendar; then it closes the form, asking
    // first once the amount or the date was changed (#343). Mounted with each opening.
    <EscapeCancelsForm
      close={close}
      busy={sending}
      onSubmit={(e) => {
        e.preventDefault();
        setShown(true);
        if (refusedDateField(e.currentTarget)) return;
        if (refusal || dateRefusal || !cents) return;
        startTransition(async () => {
          let r;
          try {
            r = cancelsRefund
              ? await cancelRefund({ key, refundId: paymentId, amountCents: cents, back })
              : await correct({ key, paymentId, amountCents: cents, back, rejectedOn: rejection ? rejectedOn : null });
          } catch (e) {
            unstable_rethrow(e);
            setMessage(NOT_SAVED);
            return;
          }
          if (!r.ok) {
            setMessage(r.message);
            return;
          }
          setMessage(null);
          if (cents === remaining) {
            // Fully corrected: the button goes away with the refresh; the section keeps the focus.
            document.getElementById(PAYMENTS_HEADING)?.focus();
            setOpen(false);
          } else close();
          router.refresh();
        });
      }}
    >
      {rejection ? (
        <>
          <Text size="xs" c="dimmed" mb={4}>
            Remis en banque le {frenchDate(rejection.depositedOn)} : la remise reste telle quelle, le montant rejeté
            redevient dû.
          </Text>
          <Text size="xs">
            Montant rejeté :{" "}
            <Text span size="xs" fw={600} className="tabular-nums">
              {formatEuros(remaining)}
            </Text>
          </Text>
          <Group gap="xs" wrap="wrap" align="flex-end" mt={4}>
            <DateField
              label="Rejeté le"
              size="xs"
              w={130}
              required
              minDate={rejection.depositedOn}
              maxDate={rejection.today}
              value={rejectedOn}
              onChange={(d) => {
                setRejectedOn(d);
                setShown(false);
              }}
              error={shown ? dateRefusal : null}
              styles={{ label: { fontSize: "var(--mantine-font-size-xs)" } }}
            />
            {/* Focus on saving, not on the date: its calendar would cover the explanation. Today is the usual day. */}
            {buttons("Enregistrer le rejet", { mb: 4 }, true)}
          </Group>
        </>
      ) : (
        <Input.Wrapper
          id={id}
          label={cancelsRefund ? "Montant à annuler (€)" : "Montant de la correction (€)"}
          description={`Au plus ${formatEuros(remaining)}`}
          error={shown ? refusal : null}
          size="xs"
          // Readable: no smaller than the rest of the table's small text.
          styles={{ description: { fontSize: "var(--mantine-font-size-xs)" } }}
        >
          {/* The buttons sit beside the field, or wrap under it with no extra gap. */}
          <Group gap="xs" wrap="wrap" align="center">
            <Input
              id={id}
              size="xs"
              w={110}
              inputMode="decimal"
              styles={{ input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
              value={amount}
              onChange={(e) => {
                setAmount(e.currentTarget.value);
                setShown(false);
              }}
              onBlur={() => setShown(true)}
              // Mantine links it to « Au plus … » and the message through the wrapper's id.
              error={shown && refusal !== null}
              autoFocus
            />
            {buttons(cancelsRefund ? "Enregistrer l’annulation" : "Enregistrer la correction")}
          </Group>
        </Input.Wrapper>
      )}
      {message && (
        <Text span role="alert" size="xs" c="red">
          {message}
        </Text>
      )}
    </EscapeCancelsForm>
  );
}
