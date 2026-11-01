"use client";

import { Button, Group, Paper, Text, TextInput } from "@mantine/core";
import { useState, useTransition } from "react";
import type { ReferralSourceRow } from "@/db/internal-rules";
import { REFERRAL_LABEL_MAX } from "@/domain/people/internal-rules";
import { type ActionResult, settle } from "@/lib/action-result";
import { ConfirmRemoval, type Removal } from "../../_ui/confirm-removal";
import { EscapeCancelsForm } from "../../_ui/escape-asks";
import { useFocusAfter } from "../../_ui/use-focus-after";
import { newReferral, removeReferral, renameReferral } from "./actions";

/**
 * Answers the school offers to « Comment nous avez-vous connus ? » (#296), in
 * the order they were added. An answer given by a student stays (statistics):
 * it can be renamed, not removed.
 */
export function Referrals({ sources }: { sources: ReferralSourceRow[] }) {
  const [label, setLabel] = useState("");
  const [edition, setEdition] = useState<{ id: string; label: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const [removal, setRemoval] = useState<Removal | null>(null);
  const focusAfter = useFocusAfter();
  const closeEdit = (id: string) => {
    focusAfter(`[data-referral-edit="${id}"]`);
    setEdition(null);
    setMessage(null);
  };
  // A refusal or a lost connection keeps what was typed, with its message (#243).
  const act = (action: () => Promise<ActionResult>, after?: () => void, failed?: () => void) =>
    startTransition(async () => {
      const r = await settle(action);
      setMessage(r.ok ? null : r.message);
      if (r.ok) after?.();
      else failed?.();
    });

  return (
    <div className="flex flex-col gap-3">
      <ConfirmRemoval removal={removal} onClose={() => setRemoval(null)} />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          act(
            () => newReferral(label),
            () => setLabel(""),
          );
        }}
      >
        <TextInput
          id="new-referral"
          label="Nouvelle réponse"
          placeholder="Bouche-à-oreille"
          maxLength={REFERRAL_LABEL_MAX}
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
        />
        <Button type="submit" variant="default" loading={inProgress} disabled={!label.trim()}>
          Ajouter
        </Button>
      </form>
      {/* A refused rename says so in its own row. */}
      {message && !edition && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
      {sources.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucune réponse proposée : la question n’est pas posée à l’inscription. Ajoutez la première ci-dessus.
        </Text>
      ) : (
        <Paper
          withBorder
          component="ul"
          aria-label="Réponses proposées"
          tabIndex={-1}
          data-after-referral-removal
          className="divide-y divide-bordure text-sm"
        >
          {sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              {edition?.id === s.id ? (
                // Escape cancels, asking first if the answer was changed (#339).
                <EscapeCancelsForm
                  close={() => closeEdit(s.id)}
                  busy={inProgress}
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(
                      () => renameReferral(s.id, edition.label),
                      () => closeEdit(s.id),
                    );
                  }}
                >
                  <TextInput
                    aria-label="Réponse"
                    autoFocus
                    maxLength={REFERRAL_LABEL_MAX}
                    value={edition.label}
                    onChange={(e) => setEdition({ ...edition, label: e.currentTarget.value })}
                  />
                  <Button type="submit" size="compact-sm" variant="default" loading={inProgress}>
                    Enregistrer
                  </Button>
                  <Button type="button" size="compact-sm" variant="subtle" color="gray" onClick={() => closeEdit(s.id)}>
                    Annuler
                  </Button>
                  {message && (
                    <Text role="alert" size="sm" c="red" className="basis-full">
                      {message}
                    </Text>
                  )}
                </EscapeCancelsForm>
              ) : (
                <span className="font-medium">{s.label}</span>
              )}
              <Text span size="sm" c="dimmed" className="tabular-nums">
                {s.students} élève{s.students > 1 ? "s" : ""}
              </Text>
              {edition?.id !== s.id && (
                <Group gap="xs" className="ml-auto">
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    aria-label={`Renommer ${s.label}`}
                    data-referral-edit={s.id}
                    onClick={() => setEdition({ id: s.id, label: s.label })}
                  >
                    Renommer
                  </Button>
                  {s.students === 0 && (
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      color="red"
                      disabled={inProgress}
                      aria-label={`Retirer ${s.label}`}
                      data-referral-remove={s.id}
                      onClick={() =>
                        setRemoval({
                          title: `Retirer la réponse « ${s.label} » ?`,
                          body: "Aucun élève ne l’a donnée. Elle ne sera plus proposée à l’inscription.",
                          run: () =>
                            act(
                              () => removeReferral(s.id),
                              () => focusAfter("[data-after-referral-removal]", "#new-referral"),
                              () => focusAfter(`[data-referral-remove="${s.id}"]`, "#new-referral"),
                            ),
                        })
                      }
                    >
                      Retirer
                    </Button>
                  )}
                </Group>
              )}
            </li>
          ))}
        </Paper>
      )}
    </div>
  );
}
