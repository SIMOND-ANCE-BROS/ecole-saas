"use client";

import { Button, Group, Paper, Text, TextInput } from "@mantine/core";
import { useState, useTransition } from "react";
import type { DisciplineRow } from "@/db/settings";
import { newDiscipline, rename, removeDiscipline } from "../actions";

export function Disciplines({ disciplines }: { disciplines: DisciplineRow[] }) {
  const [name, setName] = useState("");
  const [edition, setEdition] = useState<{ id: string; name: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const act = (action: () => Promise<{ message: string | null }>, after?: () => void) =>
    startTransition(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) after?.();
    });

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          act(
            () => newDiscipline(name),
            () => setName(""),
          );
        }}
      >
        <TextInput
          label="Nouvelle discipline"
          placeholder="Hip-hop"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Button type="submit" loading={inProgress} disabled={!name.trim()}>
          Ajouter
        </Button>
      </form>
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
      {disciplines.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucune discipline pour l’instant.
        </Text>
      ) : (
        <Paper withBorder component="ul" className="divide-y divide-bordure text-sm">
          {disciplines.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              {edition?.id === d.id ? (
                <form
                  onKeyDown={(e) => e.key === "Escape" && setEdition(null)}
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(
                      () => rename(d.id, edition.name),
                      () => setEdition(null),
                    );
                  }}
                >
                  <TextInput
                    aria-label="Nom"
                    autoFocus
                    value={edition.name}
                    onChange={(e) => setEdition({ ...edition, name: e.currentTarget.value })}
                  />
                  <Button type="submit" size="compact-sm" loading={inProgress}>
                    Enregistrer
                  </Button>
                  <Button
                    type="button"
                    size="compact-sm"
                    variant="subtle"
                    color="gray"
                    onClick={() => setEdition(null)}
                  >
                    Annuler
                  </Button>
                </form>
              ) : (
                <span className="font-medium">{d.name}</span>
              )}
              <Text span size="sm" c="dimmed">
                {d.course} cours
                {d.tariffs > 0 && `, ${d.tariffs} tarif${d.tariffs > 1 ? "s" : ""} dédié${d.tariffs > 1 ? "s" : ""}`}
              </Text>
              {edition?.id !== d.id && (
                <Group gap="xs" className="ml-auto">
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    aria-label={`Renommer ${d.name}`}
                    onClick={() => setEdition({ id: d.id, name: d.name })}
                  >
                    Renommer
                  </Button>
                  {d.course === 0 && d.tariffs === 0 && (
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      color="gray"
                      disabled={inProgress}
                      aria-label={`Retirer ${d.name}`}
                      onClick={() => act(() => removeDiscipline(d.id))}
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
