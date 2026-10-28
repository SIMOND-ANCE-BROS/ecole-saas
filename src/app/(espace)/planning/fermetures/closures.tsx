"use client";

import { Alert, Button, Input, MultiSelect, Paper, SegmentedControl, Text, TextInput } from "@mantine/core";
import { useRef, useState, useTransition } from "react";
import type { Closure } from "@/db/lessons";
import type { ClosureScope } from "@/domain/schedule/closure-scope";
import { DateField, refusedDateField } from "../../_ui/date-field";
import { close, updateLessons, reopen } from "../seances/actions";

const shortDate = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const day = (iso: string) => shortDate.format(new Date(`${iso}T00:00:00Z`));

type Option = { value: string; label: string };
type Kind = ClosureScope["kind"];

type Props = {
  closures: Closure[];
  seasonStart: string;
  seasonEnd: string;
  /** Season shown (#189): closures are added to it. */
  seasonId: string;
  /** Sites and courses of the season a closure can be limited to (#200). */
  sites: Option[];
  courses: Option[];
};

const EMPTY = {
  label: "",
  start: "",
  end: "",
  scope: "school" as Kind,
  siteIds: [] as string[],
  courseIds: [] as string[],
};

const isKind = (x: string): x is Kind => x === "school" || x === "sites" || x === "courses";

/** What a closure covers, as the list says it. */
function coverage(f: Closure): string {
  if (f.scope.kind === "school") return "Toute l’école";
  const what = f.scope.kind === "sites" ? "Site" : "Cours";
  // Every chosen site or course was deleted since: the closure no longer covers anything.
  if (f.targets.length === 0) return f.scope.kind === "sites" ? "Aucun site (supprimés)" : "Aucun cours (supprimés)";
  return `${f.targets.length > 1 && what === "Site" ? "Sites" : what} : ${f.targets.join(", ")}`;
}

export function ClosuresManagement({
  closures: closures,
  seasonStart: seasonStart,
  seasonEnd: seasonEnd,
  seasonId,
  sites,
  courses,
}: Props) {
  const [v, setV] = useState(EMPTY);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "warning" | "error" } | null>(null);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const choice = useRef<HTMLInputElement>(null);
  const label = useRef<HTMLInputElement>(null);

  // A single site is the whole school: « Certains sites » is only offered with two or more.
  const kinds = [
    { value: "school", label: "Toute l’école" },
    ...(sites.length > 1 ? [{ value: "sites", label: "Certains sites" }] : []),
    { value: "courses", label: "Certains cours", disabled: courses.length === 0 },
  ];

  const act = (action: () => Promise<{ message: string | null }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const { message: error } = await action();
      setMessage(error ? { text: error, tone: "error" } : { text: success, tone: "ok" });
      if (!error) after?.();
    });

  // Saved: how many lessons left the planning; none means the closure covers nothing on those dates.
  const add = (scope: Kind) => {
    setMessage(null);
    startTransition(async () => {
      const r = await close(entry(), seasonId);
      if (r.message) {
        setMessage({ text: r.message, tone: "error" });
        return;
      }
      const n = r.removed ?? 0;
      setMessage(
        n > 0
          ? { text: `Fermeture ajoutée : ${n} séance${n > 1 ? "s" : ""} retirée${n > 1 ? "s" : ""}.`, tone: "ok" }
          : {
              text: `Fermeture ajoutée. Aucune séance ${
                scope === "sites" ? "de ces sites " : scope === "courses" ? "de ces cours " : ""
              }n’a lieu à ces dates.`,
              tone: "warning",
            },
      );
      setV(EMPTY);
      label.current?.focus();
    });
  };

  const entry = () => {
    const base = { label: v.label, start: v.start, end: v.end || v.start };
    if (v.scope === "sites") return { ...base, scope: v.scope, siteIds: v.siteIds };
    if (v.scope === "courses") return { ...base, scope: v.scope, courseIds: v.courseIds };
    return { ...base, scope: v.scope };
  };

  return (
    <div className="flex flex-col gap-5">
      <Paper
        withBorder
        component="form"
        p="sm"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          // A date shown as refused is never sent as empty (« Date invalide »).
          if (refusedDateField(e.currentTarget)) return;
          const missing =
            v.scope === "sites" && v.siteIds.length === 0
              ? "Choisissez au moins un site."
              : v.scope === "courses" && v.courseIds.length === 0
                ? "Choisissez au moins un cours."
                : null;
          setChoiceError(missing);
          if (missing) {
            choice.current?.focus();
            return;
          }
          add(v.scope);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto] lg:items-start">
          <TextInput
            label="Libellé"
            className="sm:col-span-2 lg:col-span-1"
            placeholder="Vacances de la Toussaint"
            autoFocus
            ref={label}
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
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <Input.Wrapper
            label="Concerne"
            id="fermeture-concerne"
            labelElement="div"
            classNames={{ label: "block" }}
            className="max-w-full"
          >
            <SegmentedControl
              aria-labelledby="fermeture-concerne-label"
              data={kinds}
              value={v.scope}
              onChange={(scope) => {
                setChoiceError(null);
                if (isKind(scope)) setV({ ...v, scope });
              }}
              className="max-w-full overflow-x-auto"
            />
          </Input.Wrapper>
          {v.scope === "sites" && (
            <MultiSelect
              ref={choice}
              label="Sites fermés"
              placeholder={v.siteIds.length === 0 ? "Choisir les sites" : undefined}
              className="min-w-[16rem] flex-1"
              data={sites}
              description="Les séances de ces sites sont retirées du planning à ces dates."
              value={v.siteIds}
              onChange={(siteIds) => {
                setChoiceError(null);
                setV({ ...v, siteIds });
              }}
              error={choiceError}
            />
          )}
          {v.scope === "courses" && (
            <MultiSelect
              ref={choice}
              label="Cours annulés"
              placeholder={v.courseIds.length === 0 ? "Choisir les cours (tapez pour chercher)" : undefined}
              className="min-w-[16rem] flex-1"
              data={courses}
              description="Les séances de ces cours sont retirées du planning à ces dates."
              value={v.courseIds}
              searchable
              onSearchChange={() => setChoiceError(null)}
              nothingFoundMessage="Aucun cours trouvé"
              onChange={(courseIds) => {
                setChoiceError(null);
                setV({ ...v, courseIds });
              }}
              error={choiceError}
            />
          )}
        </div>
        <Button type="submit" loading={inProgress} className="self-start">
          Ajouter
        </Button>
      </Paper>

      {message &&
        (message.tone === "warning" ? (
          <Alert role="status" color="yellow">
            {message.text}
          </Alert>
        ) : (
          <Text
            role={message.tone === "error" ? "alert" : "status"}
            size="sm"
            c={message.tone === "error" ? "red" : undefined}
          >
            {message.text}
          </Text>
        ))}

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
                {f.period.start === f.period.end
                  ? day(f.period.start)
                  : `${day(f.period.start)} au ${day(f.period.end)}`}
              </Text>
              <Text span size="sm" c="dimmed" className="min-w-0 basis-full sm:basis-auto">
                {coverage(f)}
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
          onClick={() => act(() => updateLessons(seasonId), "Séances à venir mises à jour.")}
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
