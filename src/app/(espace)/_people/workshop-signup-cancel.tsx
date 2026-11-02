"use client";

import { Button, Group, Modal, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { settle } from "@/lib/action-result";
import { cancelSignup } from "../stages/actions";

/**
 * « Annuler » a workshop sign-up entered by mistake (#297), after a confirmation. Payments
 * already received stay on the payer's balance.
 */
export function CancelSignup({ id, summary }: { id: string; summary: string }) {
  const router = useRouter();
  const [opened, setOpened] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startSending] = useTransition();

  const close = () => {
    setOpened(false);
    setMessage(null);
  };
  const save = () =>
    startSending(async () => {
      const r = await settle(() => cancelSignup(id));
      if (!r.ok) {
        setMessage(r.message);
        return;
      }
      close();
      notifications.show({ color: "green", message: "Inscription au stage annulée" });
      router.refresh();
      // The line is gone with its button: the section keeps the focus.
      requestAnimationFrame(() => document.getElementById("stages")?.focus());
    });

  return (
    <>
      <Button
        variant="subtle"
        size="compact-xs"
        color="red"
        aria-label={`Annuler l’inscription : ${summary}`}
        onClick={() => setOpened(true)}
      >
        Annuler…
      </Button>
      <Modal opened={opened} onClose={close} title="Annuler l’inscription au stage" centered returnFocus={false}>
        <form
          className="flex flex-col gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!sending) save();
          }}
        >
          <Text size="sm">
            {summary}. À utiliser pour une inscription saisie par erreur : elle est retirée du solde du payeur. Les
            paiements déjà reçus ne changent pas.
          </Text>
          {message && (
            <Text role="alert" size="sm" c="red">
              {message}
            </Text>
          )}
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={close} data-autofocus>
              Garder l’inscription
            </Button>
            <Button type="submit" color="red" loading={sending}>
              Annuler l’inscription
            </Button>
          </Group>
        </form>
      </Modal>
    </>
  );
}
