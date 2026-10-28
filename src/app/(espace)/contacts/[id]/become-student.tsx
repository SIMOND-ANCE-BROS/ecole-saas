"use client";

import { Button, Group, Paper, Text } from "@mantine/core";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { NOT_SAVED } from "@/lib/action-result";
import { becomeStudent } from "../../eleves/actions";

/** A parent who also takes courses: they join the student list, once confirmed. */
export function BecomeStudent({ id, firstName: firstName }: { id: string; firstName: string }) {
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const confirm = useRef<HTMLButtonElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  // The question replaces the button and back: focus follows it.
  const shown = useRef(asking);
  useEffect(() => {
    if (shown.current === asking) return;
    shown.current = asking;
    (asking ? confirm : start).current?.focus();
  }, [asking]);
  // The button is disabled while saving: after a refusal or a lost connection, focus comes back to it.
  const refocus = useRef(false);
  useEffect(() => {
    if (inProgress || !refocus.current) return;
    refocus.current = false;
    confirm.current?.focus();
  }, [inProgress, message]);

  return (
    <>
      {asking ? (
        // Escape cancels, like « Annuler »: focus goes back to the button that asked.
        <Paper
          withBorder
          p="sm"
          className="flex flex-col gap-2"
          onKeyDown={(e) => {
            if (e.key !== "Escape" || inProgress) return;
            e.preventDefault();
            e.stopPropagation();
            setAsking(false);
          }}
        >
          <Text size="sm">
            {firstName} rejoint la liste des élèves, avec sa fiche élève pour l’inscrire. Ses liens et ses paiements
            restent les mêmes.
          </Text>
          <Group gap="xs">
            <Button
              ref={confirm}
              loading={inProgress}
              onClick={() =>
                startTransition(async () => {
                  try {
                    // On success the action opens the student record.
                    const r = await becomeStudent(id);
                    refocus.current = !r.ok;
                    setMessage(r.ok ? null : r.message);
                  } catch (e) {
                    unstable_rethrow(e);
                    refocus.current = true;
                    setMessage(NOT_SAVED);
                  }
                })
              }
            >
              Ajouter aux élèves
            </Button>
            <Button variant="default" disabled={inProgress} onClick={() => setAsking(false)}>
              Annuler
            </Button>
          </Group>
        </Paper>
      ) : (
        <Button ref={start} variant="default" onClick={() => setAsking(true)}>
          {firstName} prend aussi des cours
        </Button>
      )}
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
    </>
  );
}
