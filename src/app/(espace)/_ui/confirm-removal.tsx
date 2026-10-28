"use client";

import { Button, Group, Modal, Text } from "@mantine/core";

/** A removal waiting for a « yes »: what is removed, and the action to run. */
export type Removal = { title: string; body: string; run: () => void };

/**
 * Asks before removing (DESIGN.md: destructive actions are red and ask
 * first, #186). Focus starts on « Annuler », so Enter by reflex removes
 * nothing; closing gives focus back to the button that asked.
 */
export function ConfirmRemoval({ removal, onClose }: { removal: Removal | null; onClose: () => void }) {
  return (
    <Modal opened={removal !== null} onClose={onClose} title={removal?.title} centered>
      <Text size="sm">{removal?.body}</Text>
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
