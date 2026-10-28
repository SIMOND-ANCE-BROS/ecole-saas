"use client";

import { Button, Text, TextInput } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatEuros, parseEuros } from "@/lib/money";
import { correct } from "../paiements/actions";

/**
 * Correcting a payment (management): a payment is never modified, a negative
 * payment is entered instead, at most the amount not yet corrected.
 */
export function CorrectPayment({
  paymentId: paymentId,
  remaining: remaining,
  back: back,
}: {
  paymentId: string;
  remaining: number;
  back: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((remaining / 100).toFixed(2).replace(".", ","));
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  if (!open) {
    return (
      <Button variant="subtle" size="compact-xs" onClick={() => setOpen(true)}>
        Corriger
      </Button>
    );
  }
  const cents = parseEuros(amount);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!cents) return;
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
      <Text component="label" htmlFor={`correction-${paymentId}`} size="xs">
        Annuler
      </Text>
      <TextInput
        id={`correction-${paymentId}`}
        size="xs"
        w={96}
        inputMode="decimal"
        styles={{ input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
        value={amount}
        onChange={(e) => setAmount(e.currentTarget.value)}
        autoFocus
      />
      <Text span size="xs" c="dimmed">
        € sur {formatEuros(remaining)}
      </Text>
      <Button
        type="submit"
        variant="default"
        size="compact-xs"
        loading={sending}
        disabled={!cents || cents > remaining}
      >
        Enregistrer la correction
      </Button>
      <Button variant="subtle" size="compact-xs" onClick={() => setOpen(false)}>
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
