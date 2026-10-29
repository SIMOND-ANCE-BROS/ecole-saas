"use client";

import { Button, Paper, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { type ReactNode, useRef, useState, useTransition } from "react";
import { TextLink } from "@/app/(espace)/_ui/text-link";
import { rateEditStart, rateEditUnchanged, shownRate } from "@/domain/payroll/course-rates";
import type { PayMode } from "@/domain/payroll/rate";
import { courseRateLabel, PAY_UNITS, type StoredRate } from "@/domain/payroll/rate-field";
import { formatEuros } from "@/lib/money";
import { settle } from "@/lib/action-result";
import { saveCourseRate } from "../course-rate-actions";

/** A course of the instructor, as the page lists it. */
export type CourseRateRow = {
  id: string;
  /** « Jazz Débutant ». */
  name: string;
  /** « Mardi 18:00–19:00 », or « À des dates précises ». */
  slot: string;
  season: string;
  rate: StoredRate | null;
};

type Instructor = { id: string; firstName: string; payMode: PayMode; rateCents: number };

/**
 * « Tarifs par cours » (#276): the instructor's courses of the current and
 * future seasons, each rate editable in place (Enter saves, Escape cancels,
 * empty: the usual rate); past seasons' own rates below, read-only. For a
 * monthly flat instructor (`editable` false), only the stored rates, read-only.
 */
export function CourseRates({
  instructor,
  current,
  history,
  editable,
}: {
  instructor: Instructor;
  current: CourseRateRow[];
  history: CourseRateRow[];
  editable: boolean;
}) {
  return (
    <Paper withBorder p="md" component="section" aria-labelledby="tarifs-cours" className="flex min-w-0 flex-col gap-3">
      <div>
        <Title order={2} size="h5" id="tarifs-cours">
          Tarifs par cours
        </Title>
        <Text size="sm" c="dimmed">
          {editable
            ? `Un tarif saisi ici remplace, pour ce cours, le tarif habituel de ${instructor.firstName} (${formatEuros(instructor.rateCents)} / ${PAY_UNITS[instructor.payMode]}). Vide : tarif habituel.`
            : "Ces tarifs ne s’appliquent pas pour l’instant (forfait mensuel, règle en attente)."}
        </Text>
      </div>
      {editable &&
        (current.length === 0 ? (
          <Text size="sm" c="dimmed">
            Aucun cours cette saison ni les suivantes. Les cours se créent depuis le planning.
          </Text>
        ) : (
          <RateList>
            {current.map((c) => (
              <EditableRate key={c.id} row={c} instructor={instructor} />
            ))}
          </RateList>
        ))}
      {history.length > 0 && (
        <div className="flex flex-col gap-2">
          {editable && (
            <div>
              <Title order={3} size="h6">
                Saisons passées
              </Title>
              <Text size="xs" c="dimmed">
                Gardés tels quels, pour l’historique.
              </Text>
            </div>
          )}
          <RateList>
            {history.map((c) => (
              <li key={c.id} className={ROW}>
                <CourseCell row={c} />
                <RateText row={c} instructor={instructor} />
              </li>
            ))}
          </RateList>
        </div>
      )}
    </Paper>
  );
}

/** Stacked on a phone (the rate under the course, never cut), side by side from `sm`. */
const ROW = "flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4";

function RateList({ children }: { children: ReactNode }) {
  return (
    <Paper withBorder component="ul" className="divide-y divide-bordure text-sm">
      {children}
    </Paper>
  );
}

function CourseCell({ row }: { row: CourseRateRow }) {
  return (
    <div className="min-w-0">
      <TextLink href={`/planning/cours/${row.id}`} size="sm" fw={500}>
        {row.name}
      </TextLink>
      <Text size="xs" c="dimmed">
        {row.slot} · {row.season}
      </Text>
    </div>
  );
}

function RateText({ row, instructor }: { row: CourseRateRow; instructor: Instructor }) {
  const shown = shownRate(row.rate, instructor);
  return (
    <div className="tabular-nums sm:text-right">
      <Text span size="sm" c={shown.usual || shown.note ? "dimmed" : undefined}>
        {shown.label}
      </Text>
      {shown.note && (
        <Text size="xs" c="dimmed">
          {shown.note}
        </Text>
      )}
    </div>
  );
}

function EditableRate({ row, instructor }: { row: CourseRateRow; instructor: Instructor }) {
  const [rate, setRate] = useState(row.rate);
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const edit = useRef<HTMLButtonElement>(null);
  const start = rateEditStart(rate, instructor.payMode);
  const unit = PAY_UNITS[instructor.payMode];
  const shown = { ...row, rate };

  const close = () => {
    setTyped(null);
    setError(null);
    // Focus back on « Modifier » once it is shown again.
    requestAnimationFrame(() => edit.current?.focus());
  };
  const save = (value: string) => {
    if (rateEditUnchanged(start, value)) return close();
    startTransition(async () => {
      // A lost connection keeps what was typed, with a French message (#243).
      const r = await settle(() => saveCourseRate(instructor.id, row.id, { rate: value, unit: instructor.payMode }));
      if (!r.ok) return setError(r.message);
      setRate(r.rate);
      close();
      notifications.show({
        color: "green",
        message: r.rate
          ? `Tarif enregistré pour ${row.name} : ${courseRateLabel(r.rate)}.`
          : `Tarif habituel rétabli pour ${row.name}.`,
      });
    });
  };

  return (
    <li className={ROW}>
      <CourseCell row={row} />
      {typed === null ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:justify-end">
          <RateText row={shown} instructor={instructor} />
          <Button
            ref={edit}
            size="compact-sm"
            variant="subtle"
            aria-label={`Modifier le tarif de ${row.name}, ${row.slot}, saison ${row.season}`}
            onClick={() => setTyped(start)}
          >
            Modifier
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-start gap-2 sm:justify-end"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save(typed);
          }}
        >
          <TextInput
            label={`Tarif pour ${row.name}`}
            size="sm"
            className="w-56"
            autoFocus
            inputMode="decimal"
            placeholder="Tarif habituel"
            value={typed}
            onChange={(e) => {
              setTyped(e.currentTarget.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                // Escape cancels this field only, never the side panel around the page.
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
            rightSection={
              <Text span size="xs" c="dimmed" className="whitespace-nowrap">
                € / {unit}
              </Text>
            }
            rightSectionWidth={72}
            description={
              rate && start === ""
                ? `Actuellement ${courseRateLabel(rate)}, ancien mode de rémunération. Vide : tarif habituel.`
                : "Entrée : enregistrer. Échap : annuler. Vide : tarif habituel."
            }
            error={error}
          />
          <div className="flex gap-2 sm:mt-6">
            <Button type="submit" size="compact-sm" variant="default" loading={saving}>
              Enregistrer
            </Button>
            <Button type="button" size="compact-sm" variant="subtle" color="gray" onClick={close} disabled={saving}>
              Annuler
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
