"use client";

import { Button, Group, Paper, Text, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState, useTransition } from "react";
import type { SeasonRules } from "@/db/internal-rules";
import { RULES_TEXT_MAX } from "@/domain/people/internal-rules";
import { type ActionResult, settle } from "@/lib/action-result";
import { EscapeCancelsForm } from "../../_ui/escape-asks";
import { useFocusAfter } from "../../_ui/use-focus-after";
import { TextLink } from "../../_ui/text-link";
import { dayOf } from "../../_people/sections";
import { saveSeasonRules } from "./actions";

/** First line of a text, cut short: what the list shows of the rules. */
const preview = (text: string) => {
  const first = text.split("\n")[0] ?? "";
  return first.length > 90 ? `${first.slice(0, 90)}…` : first;
};

/**
 * The internal rules of each season (#296): their text, or the name of their
 * version. Saving another text keeps the earlier one for the families who
 * signed it.
 */
export function RulesTexts({ seasons }: { seasons: SeasonRules[] }) {
  const [edition, setEdition] = useState<{ seasonId: string; text: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const focusAfter = useFocusAfter();
  const closeEdit = (id: string) => {
    focusAfter(`[data-rules-text="${id}"]`);
    setEdition(null);
    setMessage(null);
  };
  const act = (action: () => Promise<ActionResult>, after: () => void) =>
    startTransition(async () => {
      const r = await settle(action);
      setMessage(r.ok ? null : r.message);
      if (r.ok) after();
    });

  if (seasons.length === 0)
    return (
      <Text size="sm" c="dimmed">
        Aucune saison pour l’instant :{" "}
        <TextLink href="/parametres/saisons" size="sm" inherit>
          créer la saison
        </TextLink>
        .
      </Text>
    );
  return (
    <Paper
      withBorder
      component="ul"
      aria-label="Règlement de chaque saison"
      className="divide-y divide-bordure text-sm"
    >
      {seasons.map((s) => (
        <li key={s.seasonId} className="flex flex-col gap-2 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">{s.seasonLabel}</span>
            <Text span size="sm" c="dimmed">
              {s.text === null
                ? "Aucun texte enregistré"
                : `Enregistré le ${dayOf(s.savedOn ?? "")}${s.versions > 1 ? ` (${s.versions} versions)` : ""}`}
              {`, ${s.acceptances} signature${s.acceptances > 1 ? "s" : ""}`}
            </Text>
            {edition?.seasonId !== s.seasonId && (
              <Button
                size="compact-sm"
                variant="subtle"
                className="ml-auto"
                data-rules-text={s.seasonId}
                aria-label={`${s.text === null ? "Saisir" : "Modifier"} le règlement ${s.seasonLabel}`}
                onClick={() => {
                  setMessage(null);
                  setEdition({ seasonId: s.seasonId, text: s.text ?? "" });
                }}
              >
                {s.text === null ? "Saisir le texte" : "Modifier le texte"}
              </Button>
            )}
          </div>
          {s.text !== null && edition?.seasonId !== s.seasonId && (
            <Text size="sm" c="dimmed" className="break-words">
              {preview(s.text)}
            </Text>
          )}
          {edition?.seasonId === s.seasonId && (
            // Escape cancels, asking first if the text was changed (#339).
            <EscapeCancelsForm
              close={() => closeEdit(s.seasonId)}
              busy={inProgress}
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                act(
                  () => saveSeasonRules(s.seasonId, edition.text),
                  () => {
                    notifications.show({ color: "green", message: `Règlement ${s.seasonLabel} enregistré.` });
                    closeEdit(s.seasonId);
                  },
                );
              }}
            >
              <Textarea
                label={`Règlement intérieur ${s.seasonLabel}`}
                description="Collez le texte du règlement, ou indiquez sa version (« Version du 29 octobre 2026 »). Les familles qui ont déjà signé gardent la version qu’elles ont acceptée."
                autoFocus
                autosize
                minRows={3}
                maxRows={14}
                maxLength={RULES_TEXT_MAX}
                value={edition.text}
                onChange={(e) => setEdition({ ...edition, text: e.currentTarget.value })}
              />
              <Group gap="xs">
                <Button type="submit" size="compact-sm" variant="default" loading={inProgress}>
                  Enregistrer
                </Button>
                <Button
                  type="button"
                  size="compact-sm"
                  variant="subtle"
                  color="gray"
                  onClick={() => closeEdit(s.seasonId)}
                >
                  Annuler
                </Button>
              </Group>
              {message && (
                <Text role="alert" size="sm" c="red">
                  {message}
                </Text>
              )}
            </EscapeCancelsForm>
          )}
        </li>
      ))}
    </Paper>
  );
}
