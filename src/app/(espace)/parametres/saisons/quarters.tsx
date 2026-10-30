"use client";

import { Button, Group, Paper, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState, useTransition } from "react";
import type { SeasonRow } from "@/db/settings";
import { settle } from "@/lib/action-result";
import { DateField, refusedDateField } from "../../_ui/date-field";
import { seasonQuarters } from "../actions";

type Row = { key: string; id: string | null; label: string; startDate: string; endDate: string };
const ordinal = (n: number) => (n === 1 ? "1er" : `${n}e`);

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

  return (
    <Paper
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
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
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
        {rows.map((r, i) => (
          <li key={r.key} className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <TextInput
              label="Libellé"
              autoFocus={i === 0}
              value={r.label}
              onChange={(e) => change(r.key, { label: e.currentTarget.value })}
            />
            <DateField
              label="Du"
              w={{ sm: 140 }}
              minDate={season.startDate}
              maxDate={season.endDate}
              value={r.startDate}
              onChange={(startDate) => change(r.key, { startDate })}
            />
            <DateField
              label="Au"
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
              aria-label={`Retirer le trimestre ${r.label || i + 1}`}
              onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
            >
              Retirer
            </Button>
          </li>
        ))}
      </ul>
      <Group gap="xs">
        <Button
          variant="default"
          onClick={() =>
            setRows((all) => [
              ...all,
              {
                key: crypto.randomUUID(),
                id: null,
                label: `${ordinal(all.length + 1)} trimestre`,
                startDate: "",
                endDate: "",
              },
            ])
          }
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
    </Paper>
  );
}
