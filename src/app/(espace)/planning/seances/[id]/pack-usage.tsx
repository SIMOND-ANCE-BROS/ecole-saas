"use client";

import { Button, Paper, Select, Text, Title } from "@mantine/core";
import { useEffect, useRef, useState, useTransition } from "react";
import type { LessonPacks, PackRow } from "@/db/lesson-packs";
import { packLabel } from "@/domain/lesson-pack/pack";
import { settle } from "@/lib/action-result";
import { countOnPack } from "../actions";

const HEADING = "carnet-seance";
const shortDate = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const names = (p: PackRow) => p.participants.map((s) => s.name).join(", ");
/** Who it is for, what remains, who pays and when it was sold: two packs never read the same. */
const describe = (p: PackRow) =>
  `${names(p)}${p.peopleCount > 1 ? ` (${p.peopleCount} personnes)` : ""} — ${packLabel(p)} · Facturé à ${p.payer} · vendu le ${shortDate.format(new Date(`${p.purchasedOn}T00:00:00Z`))}`;

/**
 * A private lesson counted on lesson packs (#286): the packs it is counted on, each
 * with « Annuler le décompte », and a picker of the packs it can be counted on
 * (arrows, Enter) with « Décompter ». A cancelled lesson is never counted (Q2 default).
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
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [inProgress, startTransition] = useTransition();
  // The picker is disabled while saving: focus comes back to it afterwards, for the next count (#244).
  const picker = useRef<HTMLInputElement>(null);
  const refocus = useRef(false);
  // The picker may only come back with the refreshed packs (a count undone): then too.
  useEffect(() => {
    if (inProgress || !refocus.current || !picker.current) return;
    refocus.current = false;
    picker.current.focus();
  }, [inProgress, packs]);

  const act = (packId: string, counted: boolean, success: string) => {
    setMessage(null);
    refocus.current = true;
    startTransition(async () => {
      const r = await settle(() => countOnPack(lessonId, packId, counted));
      if (r.ok) setChosen(null);
      setMessage(r.ok ? { text: success, error: false } : { text: r.message, error: true });
    });
  };

  return (
    <section aria-labelledby={HEADING} className="flex max-w-3xl flex-col gap-2">
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
                aria-label={`Annuler le décompte sur le carnet de ${names(p)}`}
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
          className="flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!chosen) {
              setMissing(true);
              picker.current?.focus();
              return;
            }
            act(chosen, true, "Séance décomptée du carnet.");
          }}
        >
          <Select
            ref={picker}
            className="min-w-0 flex-1"
            label={packs.counted.length > 0 ? "Décompter aussi sur un carnet" : "Décompter sur un carnet"}
            placeholder="Élève ou carnet"
            searchable
            data={packs.offered.map((p) => ({ value: p.id, label: describe(p) }))}
            value={chosen}
            onChange={(v) => {
              setChosen(v);
              setMissing(false);
            }}
            disabled={inProgress}
            error={missing ? "Choisissez un carnet" : undefined}
            nothingFoundMessage="Aucun carnet ne correspond"
          />
          {/* Level with the field, below its label. */}
          <Button type="submit" variant="default" loading={inProgress} className="mt-[25px]">
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
