"use client";

import { Button, Paper, Text, TextInput } from "@mantine/core";
import { useState, useTransition } from "react";
import type { Closure } from "@/db/lessons";
import { DateField, refusedDateField } from "../../_ui/date-field";
import { close, updateLessons, reopen } from "../seances/actions";

const shortDate = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const day = (iso: string) => shortDate.format(new Date(`${iso}T00:00:00Z`));

type Props = { closures: Closure[]; seasonStart: string; seasonEnd: string };

export function ClosuresManagement({ closures: closures, seasonStart: seasonStart, seasonEnd: seasonEnd }: Props) {
  const [v, setV] = useState({ label: "", start: "", end: "" });
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [inProgress, startTransition] = useTransition();

  const act = (action: () => Promise<{ message: string | null }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const { message: error } = await action();
      setMessage(error ? { text: error, error: true } : { text: success, error: false });
      if (!error) after?.();
    });

  return (
    <div className="flex flex-col gap-5">
      <Paper
        withBorder
        component="form"
        p="sm"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto] lg:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          // A date shown as refused is never sent as empty (« Date invalide »).
          if (refusedDateField(e.currentTarget)) return;
          act(
            () => close({ ...v, end: v.end || v.start }),
            "Fermeture ajoutée, séances mises à jour.",
            () => setV({ label: "", start: "", end: "" }),
          );
        }}
      >
        <TextInput
          label="Libellé"
          className="sm:col-span-2 lg:col-span-1"
          placeholder="Vacances de la Toussaint"
          autoFocus
          value={v.label}
          onChange={(e) => setV({ ...v, label: e.currentTarget.value })}
        />
        <DateField
          label="Du"
          minDate={seasonStart}
          maxDate={seasonEnd}
          value={v.start}
          onChange={(start) => setV({ ...v, start })}
        />
        <DateField
          label="Au (inclus)"
          minDate={v.start || seasonStart}
          maxDate={seasonEnd}
          value={v.end}
          onChange={(end) => setV({ ...v, end })}
        />
        <Button
          type="submit"
          loading={inProgress}
          className="sm:col-span-2 sm:justify-self-start lg:col-span-1 lg:mt-[25px]"
        >
          Ajouter
        </Button>
      </Paper>

      {message && (
        <Text role={message.error ? "alert" : "status"} size="sm" c={message.error ? "red" : undefined}>
          {message.text}
        </Text>
      )}

      {closures.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucune fermeture pour cette saison. Pensez aux vacances scolaires de votre zone et aux jours fériés.
        </Text>
      ) : (
        <Paper withBorder component="ul" className="divide-y divide-bordure text-sm">
          {closures.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-4 px-3 py-1.5">
              <span className="font-medium">{f.label}</span>
              <Text span size="sm" c="dimmed" className="tabular-nums">
                {f.start === f.end ? day(f.start) : `${day(f.start)} au ${day(f.end)}`}
              </Text>
              <Button
                size="compact-sm"
                variant="subtle"
                color="gray"
                className="ml-auto"
                disabled={inProgress}
                onClick={() => act(() => reopen(f.id), "Fermeture retirée, séances remises.")}
                aria-label={`Retirer la fermeture ${f.label}`}
              >
                Retirer
              </Button>
            </li>
          ))}
        </Paper>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-bordure pt-4">
        <Button
          variant="default"
          loading={inProgress}
          onClick={() => act(updateLessons, "Séances à venir mises à jour.")}
        >
          Mettre à jour les séances
        </Button>
        <Text span size="sm" c="dimmed">
          À utiliser une fois en début de saison, ou après une reprise de données.
        </Text>
      </div>
    </div>
  );
}
