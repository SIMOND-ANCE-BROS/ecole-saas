"use client";

import { Button, Paper, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { type ReactNode, useRef, useState, useTransition } from "react";
import { EscapeCancelsForm } from "@/app/(espace)/_ui/escape-asks";
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

/** Typographic space before a French « : » (U+00A0). */
const NBSP = " ";

/**
 * « Tarifs par cours » (#276): the instructor's courses of the current and
 * future seasons, each rate editable in place (Enter saves, Escape cancels,
 * empty: the usual rate; one row at a time); past seasons' own rates below,
 * read-only. For a monthly flat instructor (`editable` false), only the stored
 * rates, read-only.
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
  // The row being edited: opening another one cancels it.
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Paper withBorder p="md" component="section" aria-labelledby="tarifs-cours" className="flex min-w-0 flex-col gap-3">
      <div>
        <Title order={2} size="h5" id="tarifs-cours">
          Tarifs par cours
        </Title>
        <Text size="sm" c="dimmed">
          {editable
            ? `Tarif habituel de ${instructor.firstName}${NBSP}: ${formatEuros(instructor.rateCents)} / ${PAY_UNITS[instructor.payMode]}. Un tarif saisi ici le remplace pour ce cours.`
            : "Ces tarifs ne s’appliquent pas pour l’instant (forfait mensuel, règle en attente)."}
        </Text>
      </div>
      {editable &&
        (current.length === 0 ? (
          <Text size="sm" c="dimmed">
            Aucun cours cette saison ni les suivantes. Les cours se créent depuis le{" "}
            <TextLink href="/planning" size="sm">
              planning
            </TextLink>
            .
          </Text>
        ) : (
          <RateList>
            {current.map((c) => (
              <EditableRate
                key={c.id}
                row={c}
                instructor={instructor}
                open={open === c.id}
                onOpen={() => setOpen(c.id)}
                onClose={() => setOpen((o) => (o === c.id ? null : o))}
              />
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
                <RateText rate={c.rate} payMode={instructor.payMode} />
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

function RateText({ rate, payMode }: { rate: StoredRate | null; payMode: PayMode }) {
  const shown = shownRate(rate, payMode);
  // A rate of its own is what stands out in the list; the usual one stays grey.
  return (
    <div className="tabular-nums sm:text-right">
      <Text
        span
        size="sm"
        fw={shown.usual || shown.note ? undefined : 500}
        c={shown.usual || shown.note ? "dimmed" : undefined}
      >
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

const sameRate = (a: StoredRate | null, b: StoredRate | null) =>
  a === b || (a !== null && b !== null && a.cents === b.cents && a.payMode === b.payMode);

function EditableRate({
  row,
  instructor,
  open,
  onOpen,
  onClose,
}: {
  row: CourseRateRow;
  instructor: Instructor;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  // The saved rate, shown at once; follows the page's data when it is read again (refresh, another save).
  const [rate, setRate] = useState(row.rate);
  const [received, setReceived] = useState(row.rate);
  if (!sameRate(received, row.rate)) {
    setReceived(row.rate);
    setRate(row.rate);
  }
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const edit = useRef<HTMLButtonElement>(null);
  const unit = PAY_UNITS[instructor.payMode];

  const close = () => {
    setError(null);
    onClose();
    // Focus back on « Modifier » once it is shown again.
    requestAnimationFrame(() => edit.current?.focus());
  };
  const save = (value: string) => {
    if (rateEditUnchanged(rate, instructor.payMode, value)) return close();
    startTransition(async () => {
      // A lost connection keeps what was typed, with a French message (#243).
      const r = await settle(() => saveCourseRate(instructor.id, row.id, { rate: value, unit: instructor.payMode }));
      if (!r.ok) return setError(r.message);
      setRate(r.rate);
      close();
      notifications.show({
        color: "green",
        message: r.rate
          ? `Tarif enregistré pour ${row.name}${NBSP}: ${courseRateLabel(r.rate)}.`
          : `Tarif habituel rétabli pour ${row.name}.`,
      });
    });
  };

  return (
    <li className={ROW}>
      <CourseCell row={row} />
      {!open ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:justify-end">
          <RateText rate={rate} payMode={instructor.payMode} />
          <Button
            ref={edit}
            size="compact-sm"
            variant="subtle"
            aria-label={`Modifier le tarif de ${row.name}, ${row.slot}, saison ${row.season}`}
            onClick={() => {
              setTyped(rateEditStart(rate, instructor.payMode));
              setError(null);
              onOpen();
            }}
          >
            Modifier
          </Button>
        </div>
      ) : (
        // Escape cancels the edit, asking first once the rate was changed (#343), like the
        // other inline forms: one rule, even for a single field.
        <EscapeCancelsForm
          close={close}
          className="flex flex-col gap-1 sm:items-end"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save(typed);
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <TextInput
              label="Tarif"
              aria-label={`Tarif pour ${row.name}, ${row.slot}. Vide${NBSP}: tarif habituel.`}
              size="sm"
              // Full width on a phone, the buttons on the next line; beside them from `sm`.
              className="w-full sm:w-44"
              autoFocus
              inputMode="decimal"
              autoComplete="off"
              value={typed}
              onChange={(e) => {
                setTyped(e.currentTarget.value);
                setError(null);
              }}
              rightSection={
                <Text span size="xs" c="dimmed" className="whitespace-nowrap">
                  € / {unit}
                </Text>
              }
              rightSectionWidth={72}
              styles={{ input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
              error={error !== null}
            />
            <Button type="submit" variant="default" loading={saving}>
              Enregistrer
            </Button>
            <Button type="button" variant="subtle" color="gray" onClick={close} disabled={saving}>
              Annuler
            </Button>
          </div>
          {error ? (
            <Text role="alert" size="xs" c="red">
              {error}
            </Text>
          ) : (
            <Text size="xs" c="dimmed">
              Vide{NBSP}: tarif habituel.
            </Text>
          )}
        </EscapeCancelsForm>
      )}
    </li>
  );
}
