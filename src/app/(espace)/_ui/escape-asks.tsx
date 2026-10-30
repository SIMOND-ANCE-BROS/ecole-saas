"use client";

import { Button, Group, Modal, Table, type TableTrProps, Text } from "@mantine/core";
import { type ComponentProps, type KeyboardEvent, type ReactNode, type RefObject, useRef, useState } from "react";
import { cancelOnEscape, type EscapeKeyEvent } from "./escape-cancels";
import { useUnsavedInput } from "./unsaved-input";

/** What an inline form gets from `useEscapeCancels`: its `onKeyDown`, and the question to render. */
export type EscapeCancels = {
  onKeyDown: (e: EscapeKeyEvent) => void;
  /** « Abandonner la saisie ? », rendered anywhere inside the form's component. */
  confirm: ReactNode;
};

/**
 * Escape on the inline form in `root` (settings, #339), like Escape on a side panel (#251):
 * with a list open it only closes the list; untouched, it calls `close` at once (which gives
 * the focus back to the row's « Modifier »); with something typed or chosen, it asks
 * « Abandonner la saisie ? » first, focus on « Continuer la saisie ». The form's own
 * « Annuler » does not ask: it says what it does. The hook lives as long as the form: an edit
 * opened in a list goes through `<EscapeCancelsForm>` or `<EscapeCancelsRow>`, so that each
 * opened row starts afresh. `changed` adds what the fields cannot show (a row added with its
 * proposed values).
 */
export function useEscapeCancels(
  root: RefObject<HTMLElement | null>,
  close: () => void,
  changed: () => boolean = () => false,
): EscapeCancels {
  const fieldsHoldInput = useUnsavedInput(root);
  const holdsInput = () => changed() || fieldsHoldInput();
  const [asking, setAsking] = useState(false);
  /** The field Escape was pressed in: « Continuer la saisie » gives the focus back there. */
  const from = useRef<HTMLElement | null>(null);
  const ask = () => {
    from.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAsking(true);
  };
  const stay = () => {
    setAsking(false);
    const back = from.current;
    requestAnimationFrame(() => back?.isConnected && back.focus());
  };
  return {
    // While the question is asked, its own keys (Escape answers « Continuer la saisie ») stay there.
    onKeyDown: (e) => {
      if (!asking) cancelOnEscape(close, { holdsInput, ask })(e);
    },
    confirm: (
      <ConfirmDiscard
        opened={asking}
        onStay={stay}
        onLeave={() => {
          setAsking(false);
          close();
        }}
      />
    ),
  };
}

/**
 * An inline edit opened in a list (a site, a room, a discipline): a `<form>` that Escape
 * cancels as `useEscapeCancels` says. Mounted with the edit, so each one starts untouched.
 */
export function EscapeCancelsForm({
  close,
  onKeyDown,
  children,
  ...props
}: Omit<ComponentProps<"form">, "ref"> & { close: () => void }) {
  const root = useRef<HTMLFormElement>(null);
  const escape = useEscapeCancels(root, close);
  return (
    <form
      {...props}
      ref={root}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        escape.onKeyDown(e);
      }}
    >
      {children}
      {escape.confirm}
    </form>
  );
}

/**
 * A table row edited in place (a season): a row cannot hold a form, so the row itself is what
 * Escape cancels, as `EscapeCancelsForm`. Its own `onKeyDown` (Enter saves) runs first.
 */
export function EscapeCancelsRow({
  close,
  onKeyDown,
  children,
  ...props
}: Omit<TableTrProps, "ref" | "onKeyDown"> & {
  close: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTableRowElement>) => void;
}) {
  const root = useRef<HTMLTableRowElement>(null);
  const escape = useEscapeCancels(root, close);
  return (
    <Table.Tr
      {...props}
      ref={root}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        escape.onKeyDown(e);
      }}
    >
      {children}
      {/* Rendered in a portal: nothing lands inside the row. */}
      {escape.confirm}
    </Table.Tr>
  );
}

/**
 * « Abandonner la saisie ? », as in the side panel (#251) and like the removal confirmations
 * (#239): focus starts on « Continuer la saisie », so Enter or Escape by reflex loses nothing.
 */
function ConfirmDiscard({ opened, onStay, onLeave }: { opened: boolean; onStay: () => void; onLeave: () => void }) {
  return (
    <Modal
      opened={opened}
      onClose={onStay}
      title="Abandonner la saisie ?"
      centered
      // The focus goes back by hand: to the field after « Continuer », to « Modifier » after « Abandonner ».
      returnFocus={false}
    >
      <Text size="sm">Ce qui a été tapé ou choisi dans ce formulaire n’est pas enregistré.</Text>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onStay} data-autofocus>
          Continuer la saisie
        </Button>
        <Button color="red" onClick={onLeave}>
          Abandonner
        </Button>
      </Group>
    </Modal>
  );
}
