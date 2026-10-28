"use client";

import { Button, Text, TextInput } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { formatEuros, parseEuros } from "@/lib/money";
import { correct } from "../paiements/actions";

/**
 * Correcting a payment (management): a payment is never modified, a negative
 * payment is entered instead, at most the amount not yet corrected.
 */
export function CorrectPayment({ paymentId, remaining, back }: { paymentId: string; remaining: number; back: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((remaining / 100).toFixed(2).replace(".", ","));
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  const opener = useRef<HTMLButtonElement>(null);
  // Closed by « Fermer » or Escape: the focus goes back to « Corriger », not to the page.
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
          setOpen(true);
        }}
      >
        Corriger
      </Button>
    );
  }
  const cents = parseEuros(amount);
  // Said under the field rather than a silently disabled button.
  const refusal =
    amount.trim() === ""
      ? null
      : cents === null || cents <= 0
        ? "Montant non reconnu"
        : cents > remaining
          ? "Montant trop élevé"
          : null;
  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!cents || refusal) return;
        startTransition(async () => {
          const r = await correct(paymentId, cents, back);
          setMessage(r.message);
          if (!r.message) {
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <TextInput
        id={`correction-${paymentId}`}
        label="Montant de la correction (€)"
        description={`Au plus ${formatEuros(remaining)}`}
        size="xs"
        w={170}
        inputMode="decimal"
        styles={{ input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
        value={amount}
        onChange={(e) => setAmount(e.currentTarget.value)}
        error={refusal}
        autoFocus
      />
      <Button
        type="submit"
        variant="default"
        size="compact-xs"
        mt={36}
        loading={sending}
        disabled={!cents || refusal !== null}
      >
        Enregistrer la correction
      </Button>
      <Button variant="subtle" size="compact-xs" mt={36} onClick={close}>
        Fermer
      </Button>
      {message && (
        <Text span role="alert" size="xs" c="red">
          {message}
        </Text>
      )}
    </form>
  );
}
