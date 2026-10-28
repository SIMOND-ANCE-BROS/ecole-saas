"use client";

import { Button, Group, Input, Text } from "@mantine/core";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { NOT_SAVED } from "@/lib/action-result";
import { formatEuros, parseEuros, typedEuros } from "@/lib/money";
import { correct } from "../paiements/actions";

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

/**
 * Correcting a payment (management): a payment is never modified, a negative
 * payment is entered instead, at most the amount not yet corrected.
 */
export function CorrectPayment({ paymentId, remaining, back }: { paymentId: string; remaining: number; back: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(typedEuros(remaining));
  // The refusal shows on Enter or when leaving the field, not while typing « 12, ».
  const [shown, setShown] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  const opener = useRef<HTMLButtonElement>(null);
  // Closed by « Fermer », Escape or a saved correction: the focus goes back to « Corriger », not to the page.
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
          setOpen(true);
        }}
      >
        Corriger
      </Button>
    );
  }
  const refusal = refusalOf(amount, remaining);
  const id = `correction-${paymentId}`;
  return (
    <form
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        setShown(true);
        const cents = parseEuros(amount);
        if (refusal || !cents) return;
        startTransition(async () => {
          let r;
          try {
            r = await correct({ paymentId, amountCents: cents, back });
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
            // Fully corrected: « Corriger » goes away with the refresh; the section keeps the focus.
            document.getElementById(PAYMENTS_HEADING)?.focus();
            setOpen(false);
          } else close();
          router.refresh();
        });
      }}
    >
      <Input.Wrapper
        id={id}
        label="Montant de la correction (€)"
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
          <Button type="submit" variant="default" size="compact-xs" loading={sending}>
            Enregistrer la correction
          </Button>
          <Button variant="subtle" size="compact-xs" onClick={close}>
            Fermer
          </Button>
        </Group>
      </Input.Wrapper>
      {message && (
        <Text span role="alert" size="xs" c="red">
          {message}
        </Text>
      )}
    </form>
  );
}
