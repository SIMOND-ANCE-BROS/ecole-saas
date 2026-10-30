"use client";

import { Alert, Button, Group, Paper, Select, Table, Text, TextInput } from "@mantine/core";
import { useState, useTransition } from "react";
import type { SeasonRow } from "@/db/settings";
import { DateField, refusedDateField } from "../../_ui/date-field";
import { EscapeCancelsRow } from "../../_ui/escape-asks";
import { PHONE_LABEL, PHONE_TABLE } from "../../_ui/phone-table";
import { useFocusAfter } from "../../_ui/use-focus-after";
import { changeSeason, newSeason } from "../actions";
import { type ActionResult, settle } from "@/lib/action-result";
import { quarterMonths } from "@/domain/enrollment/quarters";
import { QuartersEditor } from "./quarters";

const date = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const day = (iso: string) => date.format(new Date(`${iso}T00:00:00Z`));

/** Suggestion for the next season: one year after the most recent one. */
function next(seasons: SeasonRow[]) {
  const last = seasons[0];
  if (!last) return { label: "", startDate: "", endDate: "" };
  const oneYearLater = (iso: string) => `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
  const [a, b] = last.label.split("-").map(Number);
  return {
    label: Number.isInteger(a) && Number.isInteger(b) ? `${a + 1}-${b + 1}` : "",
    startDate: oneYearLater(last.startDate),
    endDate: oneYearLater(last.endDate),
  };
}

const cell = PHONE_TABLE.cell;
const number = `${cell} text-right tabular-nums max-sm:text-left`;

export function Seasons({ seasons }: { seasons: SeasonRow[] }) {
  const [v, setV] = useState(next(seasons));
  const [copy, setCopy] = useState(seasons[0]?.id ?? "");
  const [edition, setEdition] = useState<{ id: string; label: string; startDate: string; endDate: string } | null>(
    null,
  );
  // Season whose quarters are being edited (#291), under the table.
  const [quartersOf, setQuartersOf] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Lessons a date edit left outside the season's new dates (#270): a warning, not a refusal.
  const [note, setNote] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const focusAfter = useFocusAfter();
  // Leaving the edit (saved, « Annuler », Escape): focus goes back to the row's « Modifier » (#186).
  const closeEdit = (id: string) => {
    focusAfter(`[data-edit="${id}"]`);
    setEdition(null);
  };
  // A refusal or a lost connection keeps what was typed, with its message (#243).
  const act = (action: () => Promise<ActionResult>, after?: () => void) =>
    startTransition(async () => {
      const r = await settle(action);
      setMessage(r.ok ? null : r.message);
      setNote(null);
      if (r.ok) after?.();
    });

  const saveEdition = (id: string, e: { label: string; startDate: string; endDate: string }) =>
    startTransition(async () => {
      const r = await settle(() => changeSeason(id, { label: e.label, startDate: e.startDate, endDate: e.endDate }));
      setMessage(r.ok ? null : r.message);
      setNote(r.ok ? r.note : null);
      if (r.ok) closeEdit(id);
    });

  return (
    <div className="flex flex-col gap-5">
      {seasons.length > 0 && (
        <Paper withBorder className="relative overflow-x-auto max-sm:overflow-visible">
          <Table className={PHONE_TABLE.table}>
            <Table.Thead className={PHONE_TABLE.head}>
              <Table.Tr>
                <Table.Th>Saison</Table.Th>
                <Table.Th>Du</Table.Th>
                <Table.Th>Au</Table.Th>
                <Table.Th className="text-right">Cours</Table.Th>
                <Table.Th className="text-right">Tarifs</Table.Th>
                <Table.Th>Trimestres</Table.Th>
                <Table.Th>
                  <span className="sr-only">Actions</span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody className={PHONE_TABLE.body}>
              {seasons.map((s) =>
                edition?.id === s.id ? (
                  <EscapeCancelsRow
                    key={s.id}
                    className={PHONE_TABLE.row}
                    // A table row cannot hold a form: Enter saves by hand. Escape cancels, asking
                    // first if anything was changed (#339).
                    close={() => closeEdit(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                        e.preventDefault();
                        if (!refusedDateField(e.currentTarget)) saveEdition(s.id, edition);
                      }
                    }}
                  >
                    <Table.Td className={`${cell} ${PHONE_TABLE.title}`}>
                      <span className={PHONE_LABEL} aria-hidden>
                        Libellé
                      </span>
                      <TextInput
                        aria-label="Libellé"
                        w={128}
                        autoFocus
                        value={edition.label}
                        onChange={(e) => setEdition({ ...edition, label: e.currentTarget.value })}
                      />
                    </Table.Td>
                    <Table.Td className={cell}>
                      <span className={PHONE_LABEL} aria-hidden>
                        Du
                      </span>
                      <DateField
                        aria-label="Début"
                        w={140}
                        value={edition.startDate}
                        onChange={(startDate) => setEdition({ ...edition, startDate })}
                      />
                    </Table.Td>
                    <Table.Td className={cell}>
                      <span className={PHONE_LABEL} aria-hidden>
                        Au
                      </span>
                      <DateField
                        aria-label="Fin"
                        w={140}
                        value={edition.endDate}
                        onChange={(endDate) => setEdition({ ...edition, endDate })}
                      />
                    </Table.Td>
                    <Table.Td className={`${number} max-sm:hidden`}>{s.course}</Table.Td>
                    <Table.Td className={`${number} max-sm:hidden`}>{s.tariffs}</Table.Td>
                    <Table.Td className={`${cell} max-sm:hidden`}>{s.quarters.map(quarterMonths).join(" · ")}</Table.Td>
                    <Table.Td className={`${cell} ${PHONE_TABLE.title}`}>
                      <Group gap="xs" wrap="nowrap">
                        <Button
                          size="compact-sm"
                          variant="light"
                          loading={inProgress}
                          onClick={(e) => {
                            const row = e.currentTarget.closest("tr");
                            if (!row || !refusedDateField(row)) saveEdition(s.id, edition);
                          }}
                        >
                          Enregistrer
                        </Button>
                        <Button size="compact-sm" variant="subtle" color="gray" onClick={() => closeEdit(s.id)}>
                          Annuler
                        </Button>
                      </Group>
                    </Table.Td>
                  </EscapeCancelsRow>
                ) : (
                  <Table.Tr key={s.id} className={PHONE_TABLE.row}>
                    <Table.Td className={`${cell} ${PHONE_TABLE.title} font-medium`}>{s.label}</Table.Td>
                    <Table.Td className={`${cell} tabular-nums`}>
                      <span className={PHONE_LABEL}>Du</span>
                      {day(s.startDate)}
                    </Table.Td>
                    <Table.Td className={`${cell} tabular-nums`}>
                      <span className={PHONE_LABEL}>Au</span>
                      {day(s.endDate)}
                    </Table.Td>
                    <Table.Td className={number}>
                      <span className={PHONE_LABEL}>Cours</span>
                      {s.course}
                    </Table.Td>
                    <Table.Td className={number}>
                      <span className={PHONE_LABEL}>Tarifs</span>
                      {s.tariffs}
                    </Table.Td>
                    <Table.Td className={cell}>
                      <span className={PHONE_LABEL}>Trimestres</span>
                      {s.quarters.length === 0 ? "Aucun" : s.quarters.map(quarterMonths).join(" · ")}
                    </Table.Td>
                    <Table.Td className={`${cell} max-sm:ml-auto`}>
                      <Group gap={4} wrap="nowrap">
                        <Button
                          size="compact-sm"
                          variant="subtle"
                          aria-label={`Modifier la saison ${s.label}`}
                          data-edit={s.id}
                          onClick={() => setEdition(s)}
                        >
                          Modifier
                        </Button>
                        <Button
                          size="compact-sm"
                          variant="subtle"
                          aria-label={`Trimestres de la saison ${s.label}`}
                          aria-expanded={quartersOf === s.id}
                          data-quarters={s.id}
                          onClick={() => setQuartersOf(quartersOf === s.id ? null : s.id)}
                        >
                          Trimestres
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ),
              )}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
      {seasons
        .filter((s) => s.id === quartersOf)
        .map((s) => (
          <QuartersEditor
            key={s.id}
            season={s}
            onClose={() => {
              // Back to the row's « Trimestres » button, as after a season edit (#186).
              focusAfter(`[data-quarters="${s.id}"]`);
              setQuartersOf(null);
            }}
          />
        ))}

      <Paper
        withBorder
        component="form"
        p="md"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (refusedDateField(e.currentTarget)) return;
          act(
            () => newSeason(v, copy || null),
            () => setV({ label: "", startDate: "", endDate: "" }),
          );
        }}
      >
        <Text size="sm" fw={600} className="sm:col-span-2 lg:col-span-4">
          Nouvelle saison
        </Text>
        <TextInput
          label="Libellé"
          placeholder="2027-2028"
          value={v.label}
          onChange={(e) => setV({ ...v, label: e.currentTarget.value })}
        />
        <DateField label="Du" value={v.startDate} onChange={(startDate) => setV({ ...v, startDate })} />
        <DateField label="Au" value={v.endDate} onChange={(endDate) => setV({ ...v, endDate })} />
        <Select
          label="Reprendre la grille de"
          allowDeselect={false}
          data={[
            { value: "", label: "Aucune (grille vide)" },
            ...seasons.map((s) => ({ value: s.id, label: s.label })),
          ]}
          value={copy}
          onChange={(c) => setCopy(c ?? "")}
        />
        <Button
          type="submit"
          // One primary button per view: the quarters editor's while it is open.
          variant={quartersOf ? "default" : "filled"}
          loading={inProgress}
          className="sm:col-span-2 sm:justify-self-start lg:col-span-4"
        >
          Créer la saison
        </Button>
      </Paper>
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
      {note && (
        <Alert role="status" color="yellow">
          {note}
        </Alert>
      )}
    </div>
  );
}
