"use client";

import { Alert, Button, Group, Input, MultiSelect, Paper, SegmentedControl, Text, TextInput } from "@mantine/core";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Closure } from "@/db/lessons";
import {
  meetsDuring,
  pickByAudience,
  type AudienceCourse,
  type AudiencePick,
} from "@/domain/schedule/closure-audience";
import type { ClosureScope } from "@/domain/schedule/closure-scope";
import { settle, type ActionResult } from "@/lib/action-result";
import { ConfirmRemoval, type Removal } from "../../_ui/confirm-removal";
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

/** A course of the season, with what ticking it by audience needs (#295). */
export type CourseOption = Option &
  Omit<AudienceCourse, "id"> &
  Parameters<typeof meetsDuring>[0] & {
    /** « 12 à 17 ans », null when no age is filled in. */
    ages: string | null;
  };

/** The audience buttons (#295), in the order management reads them. */
const AUDIENCES: { pick: AudiencePick; label: string; ticked: string }[] = [
  { pick: "children", label: "Enfants et ados", ticked: "enfants et ados" },
  { pick: "adults", label: "Adultes", ticked: "adultes" },
  { pick: "all", label: "Tous les cours collectifs", ticked: "collectifs" },
];
type Kind = ClosureScope["kind"];

type Props = {
  closures: Closure[];
  seasonStart: string;
  seasonEnd: string;
  /** Season shown (#189): closures are added to it. */
  seasonId: string;
  /** Sites and courses of the season a closure can be limited to (#200). */
  sites: Option[];
  courses: CourseOption[];
};

const EMPTY = {
  label: "",
  start: "",
  end: "",
  scope: "school" as Kind,
  siteIds: [] as string[],
  courseIds: [] as string[],
};

/** The form's first field: focus goes there once the last closure is removed. */
const LABEL = "#closure-label";

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
  const [removal, setRemoval] = useState<Removal | null>(null);
  /** What the last audience button ticked, and the courses it left for management to decide (#295). */
  const [picked, setPicked] = useState<{ label: string; count: number; undecided: CourseOption[] } | null>(null);
  /** Where focus goes once a removal is saved and the list redrawn (its button is gone). */
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    if (inProgress || !focusAfter.current) return;
    const target = document.querySelector<HTMLElement>(focusAfter.current);
    focusAfter.current = null;
    target?.focus();
  }, [inProgress, closures]);

  // A single site is the whole school: « Certains sites » is only offered with two or more.
  const kinds = [
    { value: "school", label: "Toute l’école" },
    ...(sites.length > 1 ? [{ value: "sites", label: "Certains sites" }] : []),
    { value: "courses", label: "Certains cours", disabled: courses.length === 0 },
  ];

  const act = (action: () => Promise<ActionResult>, success: string, after?: () => void) =>
    startTransition(async () => {
      // A lost connection or a server error keeps the page on screen, with a way out.
      const r = await settle(action);
      setMessage(r.ok ? { text: success, tone: "ok" } : { text: r.message, tone: "error" });
      if (r.ok) after?.();
    });

  // Saved: how many lessons left the planning; none means the closure covers nothing on those dates.
  const add = (scope: Kind) => {
    setMessage(null);
    startTransition(async () => {
      const r = await settle(() => close(entry(), seasonId));
      if (!r.ok) {
        setMessage({ text: r.message, tone: "error" });
        return;
      }
      const n = r.removed;
      // Lessons a lesson pack was counted on stay as they are (#225): the director moves them if need be.
      const k = r.keptForPack;
      const packNote =
        k > 0
          ? ` ${k} séance${k > 1 ? "s" : ""} de carnet ${k > 1 ? "sont maintenues" : "est maintenue"} : déplacez-la${
              k > 1 ? "s" : ""
            } si besoin.`
          : "";
      setMessage(
        n > 0
          ? {
              text: `Fermeture ajoutée : ${n} séance${n > 1 ? "s" : ""} retirée${n > 1 ? "s" : ""}.${packNote}`,
              tone: k > 0 ? "warning" : "ok",
            }
          : {
              // Past lessons and those whose attendance is taken are never removed.
              text: `Fermeture ajoutée. Aucune séance à venir ${
                scope === "sites" ? "de ces sites " : scope === "courses" ? "de ces cours " : ""
              }n’a été retirée.${packNote}`,
              tone: "warning",
            },
      );
      setV(EMPTY);
      setPicked(null);
      label.current?.focus();
    });
  };

  // Ticks the group courses of an audience that meet on the closure's dates (all of them while no
  // date is typed), replacing the list: management then adds or removes courses one by one.
  const tick = (a: (typeof AUDIENCES)[number]) => {
    const period = v.start ? { start: v.start, end: v.end || v.start } : null;
    const season = { start: seasonStart, end: seasonEnd };
    const held = courses.filter((c) => !period || meetsDuring(c, season, period));
    const { courseIds, undecidedIds } = pickByAudience(
      held.map((c) => ({ ...c, id: c.value })),
      a.pick,
    );
    setChoiceError(null);
    setV({ ...v, courseIds });
    setPicked({
      label: a.ticked,
      count: courseIds.length,
      undecided: held.filter((c) => undecidedIds.includes(c.value)),
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
            id={LABEL.slice(1)}
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
                setPicked(null);
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
            <Input.Wrapper
              label="Cocher les cours"
              id="fermeture-public"
              labelElement="div"
              classNames={{ label: "block" }}
              description="Selon l’âge du cours ; cours particuliers et compétition exclus."
              className="max-w-full"
            >
              <Group gap="xs" mt={4} role="group" aria-labelledby="fermeture-public-label">
                {AUDIENCES.map((a) => (
                  <Button key={a.pick} size="compact-sm" variant="default" onClick={() => tick(a)}>
                    {a.label}
                  </Button>
                ))}
              </Group>
            </Input.Wrapper>
          )}
          {v.scope === "courses" && (
            <MultiSelect
              ref={choice}
              label="Cours annulés"
              placeholder={v.courseIds.length === 0 ? "Choisir les cours (tapez pour chercher)" : undefined}
              className="min-w-[16rem] flex-1 basis-full"
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
        {v.scope === "courses" && picked && (
          <div role="status" className="flex flex-col gap-1">
            <Text size="sm">
              {picked.count === 0
                ? `Aucun cours ${picked.label} ${v.start ? "ces jours-là" : "cette saison"}.`
                : `${picked.count} cours ${picked.label} coché${picked.count > 1 ? "s" : ""}.`}
            </Text>
            {picked.undecided.length > 0 && (
              <>
                <Text size="sm" c="dimmed">
                  À décider, non cochés (pas d’âge ou mineurs et adultes ensemble) : ajoutez-les dans la liste si
                  besoin.
                </Text>
                <ul className="list-disc pl-5 text-sm">
                  {picked.undecided.map((c) => (
                    <li key={c.value}>
                      {c.label} ({c.ages ?? "âge non renseigné"})
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
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
          {closures.map((f, i) => (
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
                data-closure-remove={f.id}
                onClick={() =>
                  setRemoval({
                    title: `Retirer la fermeture « ${f.label} » ?`,
                    body: "Les séances à venir de ces dates reviennent au planning.",
                    run: () => {
                      // Refused: focus comes back to this « Retirer ». Removed: it is gone with its
                      // row, so focus moves to the next closure (or the one before, or the form).
                      const next = closures[i + 1] ?? closures[i - 1];
                      focusAfter.current = `[data-closure-remove="${f.id}"]`;
                      act(
                        () => reopen(f.id),
                        "Fermeture retirée, séances remises.",
                        () => {
                          focusAfter.current = next ? `[data-closure-remove="${next.id}"]` : LABEL;
                        },
                      );
                    },
                  })
                }
                aria-label={`Retirer la fermeture ${f.label}`}
              >
                Retirer
              </Button>
            </li>
          ))}
        </Paper>
      )}

      <ConfirmRemoval removal={removal} onClose={() => setRemoval(null)} />

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
