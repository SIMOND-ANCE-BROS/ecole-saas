"use client";

import { Button, Group, Paper, Select, Table, Text, TextInput } from "@mantine/core";
import { useState, useTransition } from "react";
import type { SeasonRow } from "@/db/settings";
import { DateField } from "../../_ui/date-field";
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

export function Seasons({ seasons: seasons }: { seasons: SeasonRow[] }) {
  const [v, setV] = useState(next(seasons));
  const [copy, setCopy] = useState(seasons[0]?.id ?? "");
  const [edition, setEdition] = useState<{ id: string; label: string; startDate: string; endDate: string } | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const act = (action: () => Promise<{ message: string | null }>, after?: () => void) =>
    startTransition(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) after?.();
    });

  return (
    <div className="flex flex-col gap-5">
      {seasons.length > 0 && (
        <Paper withBorder className="overflow-x-auto">
          <Table>
            <Table.Thead>
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
            <Table.Tbody>
              {seasons.map((s) =>
                edition?.id === s.id ? (
                  <Table.Tr key={s.id}>
                    <Table.Td>
                      <TextInput
                        aria-label="Libellé"
                        w={128}
                        autoFocus
                        value={edition.label}
                        onChange={(e) => setEdition({ ...edition, label: e.currentTarget.value })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <DateField
                        aria-label="Début"
                        w={140}
                        value={edition.startDate}
                        onChange={(startDate) => setEdition({ ...edition, startDate })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <DateField
                        aria-label="Fin"
                        w={140}
                        value={edition.endDate}
                        onChange={(endDate) => setEdition({ ...edition, endDate })}
                      />
                    </Table.Td>
                    <Table.Td className="text-right tabular-nums">{s.course}</Table.Td>
                    <Table.Td className="text-right tabular-nums">{s.tariffs}</Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Button
                          size="compact-sm"
                          loading={inProgress}
                          onClick={() =>
                            act(
                              () =>
                                changeSeason(s.id, {
                                  label: edition.label,
                                  startDate: edition.startDate,
                                  endDate: edition.endDate,
                                }),
                              () => setEdition(null),
                            )
                          }
                        >
                          Enregistrer
                        </Button>
                        <Button size="compact-sm" variant="subtle" color="gray" onClick={() => setEdition(null)}>
                          Annuler
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  <Table.Tr key={s.id}>
                    <Table.Td className="font-medium">{s.label}</Table.Td>
                    <Table.Td className="tabular-nums">{day(s.startDate)}</Table.Td>
                    <Table.Td className="tabular-nums">{day(s.endDate)}</Table.Td>
                    <Table.Td className="text-right tabular-nums">{s.course}</Table.Td>
                    <Table.Td className="text-right tabular-nums">{s.tariffs}</Table.Td>
                    <Table.Td>
                      <Button size="compact-sm" variant="subtle" onClick={() => setEdition(s)}>
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
