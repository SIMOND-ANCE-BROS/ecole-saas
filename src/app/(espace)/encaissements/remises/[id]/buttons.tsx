"use client";

import { Button, Group, Text } from "@mantine/core";
import { useEffect, useRef, useState, useTransition } from "react";
import { cancel } from "../../actions";

export function Print() {
  return <Button onClick={() => window.print()}>Imprimer le bordereau</Button>;
}

/** Cancellation of a bank deposit made by mistake (management), after confirmation. */
export function CancelDeposit({ id }: { id: string }) {
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  const opener = useRef<HTMLButtonElement>(null);
  const no = useRef<HTMLButtonElement>(null);
  // Answered « Non » (or Escape): the focus goes back to the button that asked, not to the page.
  const [declined, setDeclined] = useState(false);
  useEffect(() => {
    // The safe answer gets the focus when the question appears.
    if (confirm) no.current?.focus();
    else if (declined) opener.current?.focus();
  }, [confirm, declined]);
  const decline = () => {
    setConfirm(false);
    setDeclined(true);
  };
  if (!confirm) {
    return (
      <Button
        ref={opener}
        variant="subtle"
        color="red"
        size="compact-sm"
        onClick={() => {
          setDeclined(false);
          setConfirm(true);
        }}
      >
        Annuler la remise
      </Button>
    );
  }
  return (
    <Group
      gap="xs"
      justify="flex-end"
      role="group"
      aria-label="Annuler la remise"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          decline();
        }
      }}
    >
      <Text size="sm">Annuler cette remise ? Ses paiements redeviendront à remettre.</Text>
      <Button
        variant="outline"
        color="red"
        size="compact-sm"
        loading={sending}
        onClick={() => startTransition(async () => setMessage((await cancel(id)).message))}
      >
        Oui, annuler
      </Button>
      <Button ref={no} variant="subtle" size="compact-sm" onClick={decline}>
        Non
      </Button>
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
    </Group>
  );
}
