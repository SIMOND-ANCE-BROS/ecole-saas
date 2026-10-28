"use client";

import { Button, Group, Text } from "@mantine/core";
import { useState, useTransition } from "react";
import { cancel } from "../../actions";

export function Print() {
  return <Button onClick={() => window.print()}>Imprimer le bordereau</Button>;
}

/** Cancellation of a bank deposit made by mistake (management), after confirmation. */
export function CancelDeposit({ id }: { id: string }) {
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  if (!confirm) {
    return (
      <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirm(true)}>
        Annuler la remise
      </Button>
    );
  }
  return (
    <Group gap="xs" justify="flex-end">
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
      <Button variant="subtle" size="compact-sm" onClick={() => setConfirm(false)}>
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
