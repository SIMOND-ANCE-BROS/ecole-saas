"use client";

import { Button, Group, Paper, Select, Table, Text, TextInput } from "@mantine/core";
import { useState, useTransition } from "react";
import type { SeasonRow } from "@/db/settings";
import { DateField, refusedDateField } from "../../_ui/date-field";
import { PHONE_LABEL, PHONE_TABLE } from "../../_ui/phone-table";
import { useFocusAfter } from "../../_ui/use-focus-after";
import { changeSeason, newSeason } from "../actions";

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
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const focusAfter = useFocusAfter();
  // Leaving the edit (saved, « Annuler », Escape): focus goes back to the row's « Modifier » (#186).
  const closeEdit = (id: string) => {
    focusAfter(`[data-edit="${id}"]`);
    setEdition(null);
  };
  const act = (action: () => Promise<{ message: string | null }>, after?: () => void) =>
    startTransition(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) after?.();
    });

  const saveEdition = (id: string, e: { label: string; startDate: string; endDate: string }) =>
    act(
      () => changeSeason(id, { label: e.label, startDate: e.startDate, endDate: e.endDate }),
      () => closeEdit(id),
    );

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
                <Table.Th>
                  <span className="sr-only">Actions</span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody className={PHONE_TABLE.body}>
              {seasons.map((s) =>
                edition?.id === s.id ? (
                  <Table.Tr
                    key={s.id}
                    className={PHONE_TABLE.row}
                    // A table row cannot hold a form: Enter saves and Escape cancels by hand.
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                        e.preventDefault();
                        if (!refusedDateField(e.currentTarget)) saveEdition(s.id, edition);
                      }
                      if (e.key === "Escape") closeEdit(s.id);
                    }}
                  >
                    <Table.Td className={`${cell} ${PHONE_TABLE.title}`}>
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
                  </Table.Tr>
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
                    <Table.Td className={`${cell} max-sm:ml-auto`}>
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        aria-label={`Modifier la saison ${s.label}`}
                        data-edit={s.id}
                        onClick={() => setEdition(s)}
                      >
                        Modifier
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ),
              )}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

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
        <Button type="submit" loading={inProgress} className="sm:col-span-2 sm:justify-self-start lg:col-span-4">
          Créer la saison
        </Button>
      </Paper>
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
    </div>
  );
}
