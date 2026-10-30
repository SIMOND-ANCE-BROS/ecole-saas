"use client";

import { Button, Group, NativeSelect, Paper, Text, TextInput } from "@mantine/core";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { METHOD_LABELS } from "@/domain/payments/methods";
import { isRefundMethod, REFUND_METHODS, type RefundMethod } from "@/domain/payments/refund";
import { NOT_SAVED } from "@/lib/action-result";
import { formatEuros, parseEuros, typedEuros } from "@/lib/money";
import { refund } from "../paiements/actions";
import { DateField, refusedDateField } from "../_ui/date-field";
import { EscapeCancelsForm } from "../_ui/escape-asks";

/** Heading of the payments section (`payments-section.tsx`), focused once the refund button goes away. */
const PAYMENTS_HEADING = "paiements";

/** Why a typed amount cannot be paid back, or null. */
function refusalOf(amount: string, refundable: number): string | null {
  const cents = parseEuros(amount);
  if (amount.trim() === "" || cents === 0 || (cents !== null && cents < 0)) return "Indiquez un montant supérieur à 0";
  if (cents === null) return "Montant non reconnu";
  if (cents > refundable) return `Au plus ${formatEuros(refundable)}`;
  return null;
}

/**
 * Paying a payer back their overpayment (#294), typically after a works council cheque
 * for an enrollment already paid (management): an outgoing entry of the payment log, by
 * cheque, cash or transfer, never on a deposit slip; the amount is the overpayment unless
 * changed, never more. With several businesses, one form per business overpaid: each pays
 * back from its own account. Each opening sends with its own key (#260).
 */
export function RefundPayer({
  payerId,
  entity,
  refundable,
  back,
  today,
}: {
  payerId: string;
  /** The business paying back, named when the school has several; null otherwise. */
  entity: { id: string; name: string } | null;
  refundable: number;
  back: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [amount, setAmount] = useState(typedEuros(refundable));
  const [method, setMethod] = useState<RefundMethod>("cheque");
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  // The refusal shows on Enter or when leaving the field, not while typing « 12, ».
  const [shown, setShown] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  const opener = useRef<HTMLButtonElement>(null);
  // Closed by « Fermer » or Escape: the focus goes back to the opening button.
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (closed && !open) opener.current?.focus();
  }, [closed, open]);
  const close = () => {
    setOpen(false);
    setClosed(true);
  };
  const label = entity ? `Rembourser le trop-perçu (${entity.name})` : "Rembourser le trop-perçu";
  if (!open)
    return (
      <Button
        ref={opener}
        variant="light"
        size="compact-sm"
        className="self-start"
        onClick={() => {
          setClosed(false);
          setShown(false);
          setMessage(null);
          setAmount(typedEuros(refundable));
          setMethod("cheque");
          setDate(today);
          setReference("");
          setKey(crypto.randomUUID());
          setOpen(true);
        }}
      >
        {label}
      </Button>
    );
  const cents = parseEuros(amount);
  const refusal = refusalOf(amount, refundable);
  const dateRefusal = date === "" ? "Indiquez la date du remboursement" : null;
  const id = `remboursement-${entity?.id ?? payerId}`;
  return (
    <Paper withBorder p="sm">
      {/* Escape with the calendar open closes only the calendar; then it closes the form, asking
          first once something was changed (#343); nothing while saving. Mounted with each opening. */}
      <EscapeCancelsForm
        close={close}
        busy={sending}
        aria-label={label}
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setShown(true);
          if (refusedDateField(e.currentTarget)) return;
          if (refusal || dateRefusal || !cents) return;
          startTransition(async () => {
            let r;
            try {
              r = await refund({
                key,
                payerId,
                billingEntityId: entity?.id,
                method,
                amountCents: cents,
                date,
                reference: reference.trim() || null,
                back,
              });
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
            if (cents === refundable) {
              // Nothing left to pay back: the button goes away with the refresh; the section keeps the focus.
              document.getElementById(PAYMENTS_HEADING)?.focus();
              setOpen(false);
            } else close();
            router.refresh();
          });
        }}
      >
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Text size="xs" c="dimmed">
          Remboursable : {formatEuros(refundable)}. Le remboursement sort de la caisse ou du compte : il figure au
          journal des encaissements, jamais sur une remise en banque.
        </Text>
        {/* Aligned on the top of the fields: a message under one field does not shift the others. */}
        <div className="grid gap-2 sm:grid-cols-[8rem_10rem_9rem_1fr] sm:items-start">
          <TextInput
            id={id}
            label="Montant (€)"
            size="xs"
            required
            inputMode="decimal"
            // The overpayment is prefilled: typing replaces it rather than adding to it.
            onFocus={(e) => e.currentTarget.select()}
            styles={{ input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
            value={amount}
            onChange={(e) => {
              setAmount(e.currentTarget.value);
              setShown(false);
            }}
            onBlur={() => setShown(true)}
            error={shown ? refusal : null}
            autoFocus
          />
          <NativeSelect
            label="Moyen"
            size="xs"
            data={REFUND_METHODS.map((m) => ({ value: m, label: METHOD_LABELS[m] }))}
            value={method}
            onChange={(e) => {
              const m = e.currentTarget.value;
              if (isRefundMethod(m)) setMethod(m);
            }}
          />
          <DateField
            label="Remboursé le"
            size="xs"
            required
            maxDate={today}
            value={date}
            onChange={(d) => {
              setDate(d);
              setShown(false);
            }}
            error={shown ? dateRefusal : null}
          />
          <TextInput
            label={method === "cheque" ? "N° de chèque (facultatif)" : "Référence (facultatif)"}
            size="xs"
            maxLength={60}
            value={reference}
            onChange={(e) => setReference(e.currentTarget.value)}
          />
        </div>
        <Group gap="xs">
          {/* Not filled: « Encaisser » stays the one primary button of the section. */}
          <Button type="submit" variant="default" size="compact-sm" loading={sending}>
            Enregistrer le remboursement
          </Button>
          <Button variant="subtle" size="compact-sm" onClick={close}>
            Fermer
          </Button>
        </Group>
        {message && (
          <Text role="alert" size="xs" c="red">
            {message}
          </Text>
        )}
      </EscapeCancelsForm>
    </Paper>
  );
}
