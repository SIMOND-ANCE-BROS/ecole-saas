"use client";

import { Button, Group, Paper, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useRef, useState, useTransition } from "react";
import type { SeasonRow } from "@/db/settings";
import { addMonths } from "@/domain/invoicing/installments";
import { settle } from "@/lib/action-result";
import { DateField, refusedDateField } from "../../_ui/date-field";
import { useEscapeCancels } from "../../_ui/escape-asks";
import { seasonQuarters } from "../actions";

type Row = { key: string; id: string | null; label: string; startDate: string; endDate: string };
const ordinal = (n: number) => (n === 1 ? "1er" : `${n}e`);
const dayAfter = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Dates proposed for an added quarter: from the day after the last one ends, for three months,
 * within the season; empty when the last quarter already ends the season.
 */
function nextQuarter(rows: Row[], season: SeasonRow): { startDate: string; endDate: string } {
  const last = rows
    .map((r) => r.endDate)
    .filter(Boolean)
    .sort()
    .at(-1);
  const startDate = last ? dayAfter(last) : season.startDate;
  if (startDate > season.endDate) return { startDate: "", endDate: "" };
  const threeMonths = addMonths(startDate, 3);
  const end = new Date(Date.parse(`${threeMonths}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return { startDate, endDate: end < season.endDate ? end : season.endDate };
}

/**
 * Editor of a season's quarters (#291), under the seasons table: label and dates of each
 * one, added or removed, saved together. A refusal keeps what was typed, with its message.
 */
export function QuartersEditor({ season, onClose }: { season: SeasonRow; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => season.quarters.map((q) => ({ key: q.id, ...q })));
  const [message, setMessage] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const change = (key: string, patch: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const titleId = `trimestres-${season.id}`;
  const addId = `ajouter-trimestre-${season.id}`;
  // Escape closes the editor, asking first if a quarter was changed, added or removed (#339).
  const form = useRef<HTMLFormElement>(null);
  // A quarter added starts from its proposed dates, which no field shows as changed.
  const escape = useEscapeCancels(form, onClose, () => rows.some((r) => r.id === null));

  return (
    <Paper
      ref={form}
      withBorder
      component="form"
      p="md"
      aria-labelledby={titleId}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (refusedDateField(e.currentTarget)) return;
        startSaving(async () => {
          const r = await settle(() =>
            seasonQuarters(
              season.id,
              rows.map(({ id, label, startDate, endDate }) => ({ id, label, startDate, endDate })),
            ),
          );
          setMessage(r.ok ? null : r.message);
          if (r.ok) {
            notifications.show({ color: "green", message: "Trimestres enregistrés" });
            onClose();
          }
        });
      }}
      onKeyDown={escape.onKeyDown}
    >
      <div>
        <Title order={2} size="h6" id={titleId}>
          Trimestres de la saison {season.label}
        </Title>
        <Text size="xs" c="dimmed">
          Une inscription au trimestre paie le prix du trimestre pour chaque trimestre restant à sa date d’inscription,
          le trimestre commencé compris. Modifier les trimestres ne change pas les inscriptions déjà enregistrées.
        </Text>
      </div>
      {rows.length === 0 && (
        <Text size="sm">Aucun trimestre : les inscriptions au trimestre sont refusées pour cette saison.</Text>
      )}
      <ul className="flex flex-col gap-3">
        {rows.map((r, i) => {
          // Each row's fields are named after its quarter for a screen reader (« Du, 2e trimestre »).
          const name = r.label.trim() || `trimestre ${i + 1}`;
          return (
            <li key={r.key} className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
              <TextInput
                id={`${r.key}-libelle`}
                label="Libellé"
                required
                autoFocus={i === 0}
                value={r.label}
                onChange={(e) => change(r.key, { label: e.currentTarget.value })}
              />
              <DateField
                label="Du"
                aria-label={`Du, ${name}`}
                required
                w={{ sm: 140 }}
                minDate={season.startDate}
                maxDate={season.endDate}
                value={r.startDate}
                onChange={(startDate) => change(r.key, { startDate })}
              />
              <DateField
                label="Au"
                aria-label={`Au, ${name}`}
                required
                w={{ sm: 140 }}
                minDate={season.startDate}
                maxDate={season.endDate}
                value={r.endDate}
                onChange={(endDate) => change(r.key, { endDate })}
              />
              <Button
                variant="subtle"
                color="red"
                className="justify-self-start"
                data-remove={r.key}
                aria-label={`Retirer « ${name} »`}
                onClick={() => {
                  // Focus moves on to the next row's « Retirer », or to « Ajouter un trimestre ».
                  const next = rows[i + 1] ?? rows[i - 1];
                  setRows((all) => all.filter((x) => x.key !== r.key));
                  requestAnimationFrame(() =>
                    document.querySelector<HTMLElement>(next ? `[data-remove="${next.key}"]` : `#${addId}`)?.focus(),
                  );
                }}
              >
                Retirer
              </Button>
            </li>
          );
        })}
      </ul>
      <Group gap="xs">
        <Button
          id={addId}
          variant="default"
          onClick={() => {
            const key = crypto.randomUUID();
            setRows((all) => [
              ...all,
              { key, id: null, label: `${ordinal(all.length + 1)} trimestre`, ...nextQuarter(all, season) },
            ]);
            // Focus goes to the new quarter, ready to be named or dated.
            requestAnimationFrame(() => document.getElementById(`${key}-libelle`)?.focus());
          }}
        >
          Ajouter un trimestre
        </Button>
      </Group>
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
      <Group gap="xs">
        <Button type="submit" loading={saving}>
          Enregistrer les trimestres
        </Button>
        <Button variant="subtle" color="gray" onClick={onClose}>
          Annuler
        </Button>
      </Group>
      {escape.confirm}
    </Paper>
  );
}
