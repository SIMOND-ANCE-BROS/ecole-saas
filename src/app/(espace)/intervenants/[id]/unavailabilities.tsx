"use client";

import { Button, Paper, Text, TextInput, Title } from "@mantine/core";
import { TimeInput } from "@mantine/dates";
import { useState, useTransition } from "react";
import { DateField, refusedDateField } from "@/app/(espace)/_ui/date-field";
import { addUnavailabilityAction, removeUnavailability } from "../actions";
import { NOT_SAVED, orNotSaved } from "@/lib/action-result";

export type DisplayedUnavailability = {
  id: string;
  start: string;
  end: string;
  source: "manual" | "google" | "microsoft";
  label: string | null;
};

const SOURCE = { manual: null, google: "Google Agenda", microsoft: "Microsoft" } as const;
const day = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Europe/Paris",
});
const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

/** « mer. 4 nov., 16:30 à 19:00 », or « mer. 4 nov. au ven. 6 nov. » for whole days. */
function range(isoStart: string, isoEnd: string): string {
  const start = new Date(isoStart);
  const end = new Date(isoEnd);
  const midnight = (d: Date) => time.format(d) === "00:00";
  if (midnight(start) && midnight(end)) {
    const last = new Date(end.getTime() - 1);
    return day.format(start) === day.format(last)
      ? `${day.format(start)}, journée`
      : `${day.format(start)} au ${day.format(last)}`;
  }
  return day.format(start) === day.format(end)
    ? `${day.format(start)}, ${time.format(start)} à ${time.format(end)}`
    : `${day.format(start)} ${time.format(start)} au ${day.format(end)} ${time.format(end)}`;
}

/** Upcoming unavailabilities of an instructor; those from a connected calendar cannot be removed here. */
export function Unavailabilities({
  instructorId: instructorId,
  firstName: firstName,
  unavailabilities: unavailabilities,
}: {
  instructorId: string;
  firstName: string;
  unavailabilities: DisplayedUnavailability[];
}) {
  const [v, setV] = useState({ fromDate: "", toDate: "", fromTime: "", toTime: "", label: "" });
  const [message, setMessage] = useState<string | null>(null);
  // Missing start or an end before the start, shown on the field itself.
  const [dateError, setDateError] = useState<{ field: "fromDate" | "toDate"; text: string } | null>(null);
  // As refusedDateField(): focus without the calendar opening over a message.
  const focusDate = (id: "indispo-du" | "indispo-au") => {
    const input = document.getElementById(id);
    if (input && document.activeElement !== input) {
      input.dataset.quietFocus = "1";
      input.focus();
    }
  };
  const refuse = (field: "fromDate" | "toDate", text: string) => {
    setDateError({ field, text });
    focusDate(field === "fromDate" ? "indispo-du" : "indispo-au");
  };
  const [inProgress, startTransition] = useTransition();
  const updated = (field: keyof typeof v) => (e: { currentTarget: { value: string } }) =>
    setV({ ...v, [field]: e.currentTarget.value });

  return (
    <Paper
      withBorder
      p="md"
      component="section"
      aria-labelledby="indisponibilites"
      className="flex min-w-0 flex-col gap-3"
    >
      <div>
        <Title order={2} size="h5" id="indisponibilites">
          Indisponibilités de {firstName}
        </Title>
        <Text size="sm" c="dimmed">
          Elles signalent les séances en conflit et écartent {firstName} des remplaçants proposés.
        </Text>
      </div>

      {unavailabilities.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucune indisponibilité à venir.
        </Text>
      ) : (
        <Paper withBorder component="ul" className="divide-y divide-bordure text-sm">
          {unavailabilities.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5">
              <span className="tabular-nums">{range(i.start, i.end)}</span>
              {i.label && (
                <Text span size="sm" c="dimmed">
                  {i.label}
                </Text>
              )}
              {SOURCE[i.source] ? (
                <Text span size="xs" c="dimmed" className="ml-auto">
                  {SOURCE[i.source]}
                </Text>
              ) : (
                <Button
                  size="compact-sm"
                  variant="subtle"
                  color="gray"
                  className="ml-auto"
                  disabled={inProgress}
                  aria-label={`Retirer l’indisponibilité du ${range(i.start, i.end)}`}
                  onClick={() =>
                    startTransition(async () => {
                      setMessage(
                        (
                          await orNotSaved(
                            () => removeUnavailability(instructorId, i.id),
                            () => ({ message: NOT_SAVED }),
                          )
                        ).message,
                      );
                      // The button leaves with its row: focus goes back to the entry, not to the page.
                      focusDate("indispo-du");
                    })
                  }
                >
                  Retirer
                </Button>
              )}
            </li>
          ))}
        </Paper>
      )}

      <form
        className="grid gap-3 sm:grid-cols-4 sm:items-start"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          // A date shown as refused is never sent as empty.
          if (refusedDateField(e.currentTarget)) return;
          if (!v.fromDate) return refuse("fromDate", "Indiquez la date de début.");
          if (v.toDate && v.toDate < v.fromDate) return refuse("toDate", "La fin doit suivre le début.");
          setDateError(null);
          startTransition(async () => {
            const { message: error } = await orNotSaved(
              () => addUnavailabilityAction(instructorId, { ...v, toDate: v.toDate || v.fromDate }),
              () => ({ message: NOT_SAVED }),
            );
            setMessage(error);
            if (!error) {
              setV({ fromDate: "", toDate: "", fromTime: "", toTime: "", label: "" });
              // Ready for the next one.
              focusDate("indispo-du");
            }
          });
        }}
      >
        <DateField
          id="indispo-du"
          label="Du"
          required
          value={v.fromDate}
          onChange={(fromDate) => {
            setDateError(null);
            setV({ ...v, fromDate });
          }}
          error={dateError?.field === "fromDate" ? dateError.text : undefined}
        />
        <DateField
          id="indispo-au"
          label="Au (inclus)"
          minDate={v.fromDate || undefined}
          value={v.toDate}
          onChange={(toDate) => {
            setDateError(null);
            setV({ ...v, toDate });
          }}
          error={dateError?.field === "toDate" ? dateError.text : undefined}
        />
        <TimeInput label="De (facultatif)" value={v.fromTime} onChange={updated("fromTime")} />
        <TimeInput label="À (facultatif)" value={v.toTime} onChange={updated("toTime")} />
        <TextInput
          label="Motif (facultatif)"
          className="sm:col-span-3"
          placeholder="Stage, congé, rendez-vous…"
          value={v.label}
          onChange={updated("label")}
        />
        <Button type="submit" variant="default" loading={inProgress} className="sm:self-end sm:justify-self-start">
          Ajouter
        </Button>
      </form>
      <Text size="xs" c="dimmed">
        Sans heures : journées entières. Heures de Paris.
      </Text>
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
    </Paper>
  );
}
