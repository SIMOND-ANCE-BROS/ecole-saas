"use client";

import { Button, Group, Modal, Text } from "@mantine/core";
import { useState } from "react";

/** A removal waiting for a « yes »: what is removed, and the action to run. */
export type Removal = { title: string; body: string; run: () => void };

/**
 * Asks before removing (DESIGN.md: destructive actions are red and ask
 * first, #186). Focus starts on « Annuler », so Enter by reflex removes
 * nothing. « Annuler » or Escape gives focus back to the button that asked;
 * after a removal that button is gone with its row, so the caller moves the
 * focus (to the list or its heading) once the removal succeeds.
 */
export function ConfirmRemoval({ removal, onClose }: { removal: Removal | null; onClose: () => void }) {
  // The last request stays on screen while the modal fades out.
  const [shown, setShown] = useState(removal);
  if (removal && removal !== shown) setShown(removal);
  const r = removal ?? shown;
  return (
    <Modal opened={removal !== null} onClose={onClose} title={r?.title} centered>
      <Text size="sm">{r?.body}</Text>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose} data-autofocus>
          Annuler
        </Button>
        <Button
          color="red"
          onClick={() => {
            removal?.run();
            onClose();
          }}
        >
          Retirer
        </Button>
      </Group>
    </Modal>
  );
}
