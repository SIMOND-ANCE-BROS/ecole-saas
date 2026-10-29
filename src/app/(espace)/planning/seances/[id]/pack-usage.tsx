"use client";

import { Button, Paper, Select, Text, Title } from "@mantine/core";
import { useState, useTransition } from "react";
import type { LessonPacks } from "@/db/lesson-packs";
import { packLabel } from "@/domain/lesson-pack/pack";
import { settle } from "@/lib/action-result";
import { countOnPack } from "../actions";

const HEADING = "carnet-seance";
const names = (p: LessonPacks["counted"][number]) => p.participants.map((s) => s.name).join(", ");

/**
 * A private lesson counted on lesson packs (#286): the packs it is counted on, each
 * with « Annuler le décompte », and a picker of open packs (arrows, Enter) with
 * « Décompter ». A cancelled lesson is never counted (Q2 default).
 */
export function PackUsage({
  lessonId,
  cancelled,
  packs,
}: {
  lessonId: string;
  cancelled: boolean;
  packs: LessonPacks;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [inProgress, startTransition] = useTransition();
  const ofLesson = packs.offered.filter((p) => p.ofLesson);
  const others = packs.offered.filter((p) => !p.ofLesson);
  const option = (p: LessonPacks["offered"][number]) => ({ value: p.id, label: `${names(p)} — ${packLabel(p)}` });
  const data = [
    ...(ofLesson.length > 0 ? [{ group: "Élèves de la séance", items: ofLesson.map(option) }] : []),
    ...(others.length > 0
      ? [{ group: ofLesson.length > 0 ? "Autres carnets" : "Carnets en cours", items: others.map(option) }]
      : []),
  ];

  const act = (packId: string, counted: boolean, success: string) =>
    startTransition(async () => {
      const r = await settle(() => countOnPack(lessonId, packId, counted));
      if (r.ok) setChosen(null);
      setMessage(r.ok ? { text: success, error: false } : { text: r.message, error: true });
    });

  return (
    <section aria-labelledby={HEADING} className="flex flex-col gap-2">
      <Title order={2} size="h5" id={HEADING}>
        Carnet de cours particuliers
      </Title>
      {packs.counted.length > 0 && (
        <Paper withBorder component="ul" className="divide-y divide-bordure">
          {packs.counted.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
              <span className="flex min-w-0 flex-col">
                <Text span size="sm" fw={500}>
                  Décomptée sur : {packLabel(p)}
                </Text>
                <Text span size="xs" c="dimmed">
                  Pour {names(p)} · Facturé à {p.payer}
                </Text>
              </span>
              <Button
                variant="subtle"
                size="compact-sm"
                disabled={inProgress}
                onClick={() => act(p.id, false, "Décompte annulé : la séance est rendue au carnet.")}
              >
                Annuler le décompte
              </Button>
            </li>
          ))}
        </Paper>
      )}
      {cancelled ? (
        <Text size="sm" c="dimmed">
          Séance annulée : elle ne se décompte pas d’un carnet.
        </Text>
      ) : packs.offered.length === 0 ? (
        packs.counted.length === 0 && (
          <Text size="sm" c="dimmed">
            Aucun carnet en cours. Vendez-en un depuis la fiche de l’élève.
          </Text>
        )
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!chosen) {
              setMessage({ text: "Choisissez un carnet.", error: true });
              return;
            }
            act(chosen, true, "Séance décomptée du carnet.");
          }}
        >
          <Select
            className="min-w-0 flex-1 sm:max-w-md"
            label={packs.counted.length > 0 ? "Décompter aussi sur un carnet" : "Décompter sur un carnet"}
            placeholder="Élève ou carnet"
            searchable
            data={data}
            value={chosen}
            onChange={setChosen}
            disabled={inProgress}
            nothingFoundMessage="Aucun carnet ne correspond"
          />
          <Button type="submit" variant="default" loading={inProgress}>
            Décompter
          </Button>
        </form>
      )}
      {message && (
        <Text role={message.error ? "alert" : "status"} size="sm" c={message.error ? "red" : undefined}>
          {message.text}
        </Text>
      )}
    </section>
  );
}
