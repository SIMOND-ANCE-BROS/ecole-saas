"use client";

import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Fieldset,
  NativeSelect,
  Paper,
  Radio,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { Preview } from "@/db/enrollments";
import type { ScheduleCourse } from "@/db/schedule";
import { overlaps } from "@/domain/schedule/overlap";
import { formatEuros } from "@/lib/money";
import { deferredQuery } from "@/lib/deferred-query";
import { preview, enroll, type FormInput } from "./actions";
import { NOT_SAVED, orNotSaved } from "@/lib/action-result";

const DAYS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const AUDIENCES = [
  ["child", "Enfant"],
  ["adult", "Adulte"],
  ["couple", "Couple"],
  ["student", "Étudiant"],
] as const;
const PERIODS = [
  ["quarter", "Trimestre"],
  ["year", "Année"],
] as const;

type Props = {
  payerId: string;
  students: { id: string; firstName: string; age: number | null }[];
  courses: ScheduleCourse[];
  /** Student chosen in advance (« Inscrire » button on their record). */
  initialStudent?: string;
};

export function EnrollmentForm({ payerId, students, courses, initialStudent }: Props) {
  const initial = students.find((d) => d.id === initialStudent) ?? (students.length === 1 ? students[0] : undefined);
  const [studentIds, setStudentIds] = useState<string[]>(initial ? [initial.id] : []);
  const [chosenAudience, setAudience] = useState<FormInput["audience"]>(
    initial && initial.age !== null && initial.age >= 18 ? "adult" : "child",
  );
  const [period, setPeriod] = useState<FormInput["period"]>("quarter");
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [lastPreview, setPreview] = useState<{
    entry: FormInput;
    attempt: number;
    result: Preview | null;
    error: boolean;
  } | null>(null);
  const [calculationAttempt, setCalculationAttempt] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sending, startSend] = useTransition();

  const entry: FormInput = useMemo(
    () => ({
      payerId,
      studentIds,
      audience: chosenAudience,
      period,
      courseIds,
    }),
    [payerId, studentIds, chosenAudience, period, courseIds],
  );

  // No price from a previous selection is shown as the current price.
  useEffect(() => {
    if (entry.studentIds.length === 0 || entry.courseIds.length === 0) return;
    return deferredQuery(
      () => preview(entry),
      (result) => setPreview({ entry, attempt: calculationAttempt, result, error: false }),
      () => setPreview({ entry, attempt: calculationAttempt, result: null, error: true }),
    );
  }, [entry, calculationAttempt]);
  const current = lastPreview?.entry === entry && lastPreview.attempt === calculationAttempt ? lastPreview : null;
  const calculation = studentIds.length > 0 && courseIds.length > 0 && current === null;
  const result = current?.result ?? null;

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const visibleCourses = courses.filter((c) =>
    `${c.discipline} ${c.level ?? ""} ${DAYS[c.weekday ?? 0]}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const next = result?.status === "ok" ? result.newEnrollment : null;
  const canSave = next?.status === "ok" && !calculation && !sending;

  // Courses suited to the chosen student(s)' age first; the others remain selectable.
  const chosenAges = students.filter((d) => studentIds.includes(d.id) && d.age !== null).map((d) => d.age as number);
  const adapted = (c: ScheduleCourse) =>
    chosenAges.length === 0 ||
    chosenAges.every((a) => (c.ageMin === null || a >= c.ageMin) && (c.ageMax === null || a <= c.ageMax));
  const sortedCourses = [...visibleCourses.filter(adapted), ...visibleCourses.filter((c) => !adapted(c))];

  // Chosen courses that overlap on the same day.
  const chosen = courses.filter((c) => courseIds.includes(c.id));
  const overlappingCourses = chosen.flatMap((a, i) =>
    chosen
      .slice(i + 1)
      .filter((b) => overlaps(a, b))
      .map((b) => `${a.discipline} et ${b.discipline} le ${DAYS[a.weekday ?? 0].toLowerCase()}`),
  );

  return (
    <form
      className="grid gap-6 lg:grid-cols-[1fr_22rem]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        setRefusal(null);
        startSend(async () =>
          setRefusal(
            (
              await orNotSaved(
                () => enroll(entry),
                () => ({ message: NOT_SAVED }),
              )
            ).message,
          ),
        );
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canSave) {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }
      }}
    >
      <nav aria-label="Repères de saisie" className="lg:col-span-2">
        <ol className="grid grid-cols-3 gap-2 text-sm">
          {[
            { target: "choix-danseur", title: "Danseur & formule", full: studentIds.length > 0 },
            { target: "choix-cours", title: "Cours", full: courseIds.length > 0 },
            { target: "prix-inscription", title: "Vérification du prix", full: canSave },
          ].map((step, index) => (
            <li key={step.target}>
              <Paper
                component="a"
                href={`#${step.target}`}
                withBorder
                px="sm"
                py="xs"
                c={step.full ? undefined : "dimmed"}
                className="flex h-full items-center gap-2 text-sm"
                style={
                  step.full
                    ? {
                        borderColor: "var(--mantine-primary-color-filled)",
                        background: "var(--mantine-primary-color-light)",
                      }
                    : undefined
                }
              >
                <span aria-hidden className="font-semibold">
                  {index + 1}
                </span>
                <span>{step.title}</span>
                {step.full && <span className="sr-only"> : renseigné</span>}
              </Paper>
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex min-w-0 flex-col gap-4">
        <legend className="sr-only">Choix de l’inscription</legend>
        <Fieldset
          id="choix-danseur"
          legend={`Danseur${chosenAudience === "couple" ? "s (deux)" : ""}`}
          className="flex flex-col gap-2"
        >
          {students.map((d) => {
            const label = (
              <>
                {d.firstName}{" "}
                {d.age !== null && (
                  <Text span size="sm" c="dimmed">
                    ({d.age} ans)
                  </Text>
                )}
              </>
            );
            const onChange = () => setStudentIds(chosenAudience === "couple" ? toggle(studentIds, d.id) : [d.id]);
            return chosenAudience === "couple" ? (
              <Checkbox
                key={d.id}
                name="danseur"
                label={label}
                checked={studentIds.includes(d.id)}
                onChange={onChange}
              />
            ) : (
              <Radio key={d.id} name="danseur" label={label} checked={studentIds.includes(d.id)} onChange={onChange} />
            );
          })}
        </Fieldset>

        <div className="flex flex-wrap items-start gap-4">
          <NativeSelect
            id="public"
            label="Public"
            value={chosenAudience}
            data={AUDIENCES.map(([value, label]) => ({ value, label }))}
            onChange={(e) => {
              const value = e.currentTarget.value as FormInput["audience"];
              setAudience(value);
              if (value !== "couple") setStudentIds(studentIds.slice(0, 1));
            }}
          />
          <NativeSelect
            id="periodicite"
            label="Périodicité"
            value={period}
            data={PERIODS.map(([value, label]) => ({ value, label }))}
            onChange={(e) => setPeriod(e.currentTarget.value as FormInput["period"])}
          />
        </div>

        <fieldset id="choix-cours" className="flex flex-col gap-2">
          <Text component="legend" size="sm" fw={600} mb={4}>
            Cours ({courseIds.length} choisi{courseIds.length > 1 ? "s" : ""})
          </Text>
          <TextInput
            id="filtre-cours"
            type="search"
            // The courses are what changes most from one enrollment to the next: typing starts here.
            autoFocus
            aria-label="Filtrer les cours"
            className="max-w-xs"
            placeholder="Filtrer : jazz, mercredi, adultes…"
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
          />
          <Paper withBorder component="ul" className="flex max-h-96 flex-col overflow-y-auto">
            {sortedCourses.length === 0 && (
              <li className="flex flex-col items-start gap-2 p-3">
                <Text size="sm" c="dimmed">
                  {courses.length === 0
                    ? "Aucun cours n’est disponible pour cette saison."
                    : "Aucun cours ne correspond à votre recherche."}
                </Text>
                {filter && (
                  <Button variant="default" onClick={() => setFilter("")}>
                    Effacer le filtre
                  </Button>
                )}
              </li>
            )}
            {sortedCourses.map((c) => {
              const restantes = c.maxCapacity === null ? null : c.maxCapacity - c.enrolled;
              return (
                <li key={c.id} className="border-b border-bordure last:border-0">
                  {/* The whole row is the checkbox's label: one click target, the course as its name. */}
                  <Checkbox
                    radius="xs"
                    checked={courseIds.includes(c.id)}
                    onChange={() => setCourseIds(toggle(courseIds, c.id))}
                    classNames={{
                      root: "hover:bg-accent-doux/40",
                      body: "items-start px-2 py-2 sm:items-center sm:py-1",
                      labelWrapper: "min-w-0 flex-1",
                      label: "flex cursor-pointer items-baseline gap-2 text-sm",
                    }}
                    label={
                      <>
                        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                          <span className="w-20 shrink-0">{c.weekday ? DAYS[c.weekday] : "Stage"}</span>
                          <span className="w-12 shrink-0 tabular-nums">{c.startTime}</span>
                          <span className="font-medium">{c.discipline}</span>
                          <Text span size="sm" c="dimmed" className="basis-full sm:basis-auto">
                            {c.durationMinutes} min{c.level ? `, ${c.level}` : ""}, {c.room}
                          </Text>
                          {/* A tag rather than faded text: still readable, still selectable. */}
                          {!adapted(c) && (
                            <Badge color="gray" variant="light" radius="sm" tt="none" fw={400}>
                              hors tranche d’âge
                            </Badge>
                          )}
                        </span>
                        {restantes !== null &&
                          (restantes <= 0 ? (
                            <Badge color="yellow" variant="light" radius="sm" tt="none" className="shrink-0">
                              complet
                            </Badge>
                          ) : (
                            <Text span size="xs" c="dimmed" className="shrink-0 tabular-nums">
                              {restantes} place{restantes > 1 ? "s" : ""}
                            </Text>
                          ))}
                      </>
                    }
                  />
                </li>
              );
            })}
          </Paper>
          {chosen.length > 0 && (
            <ul aria-label="Cours choisis" className="flex flex-wrap gap-1.5">
              {chosen.map((c) => (
                <li key={c.id}>
                  <Button
                    size="compact-xs"
                    variant="light"
                    fw={400}
                    onClick={() => setCourseIds(courseIds.filter((x) => x !== c.id))}
                    aria-label={`Retirer ${c.discipline} ${c.weekday ? DAYS[c.weekday] : ""} ${c.startTime}`}
                  >
                    {c.discipline} {c.weekday ? DAYS[c.weekday].slice(0, 3).toLowerCase() + "." : ""} {c.startTime} ×
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {overlappingCourses.length > 0 && (
            <Alert role="alert" color="yellow" p="xs">
              <Text size="xs">Horaires qui se chevauchent : {overlappingCourses.join(" ; ")}.</Text>
            </Alert>
          )}
        </fieldset>
      </div>

      <Paper
        component="aside"
        withBorder
        p="sm"
        id="prix-inscription"
        aria-live="polite"
        aria-busy={calculation}
        className="flex flex-col gap-3 self-start text-sm lg:sticky lg:top-16"
      >
        <Title order={2} size="h6">
          Récapitulatif de l’inscription
        </Title>
        <div className="border-b border-bordure pb-3">
          <Text size="sm" fw={500}>
            {students
              .filter((d) => studentIds.includes(d.id))
              .map((d) => d.firstName)
              .join(" et ") || "Aucun danseur sélectionné"}
          </Text>
          <Text size="xs" c="dimmed">
            {AUDIENCES.find(([v]) => v === chosenAudience)?.[1]} · {PERIODS.find(([v]) => v === period)?.[1]}
          </Text>
          <Text size="xs" c="dimmed">
            {chosen.length} cours · {chosen.reduce((total, c) => total + c.durationMinutes, 0)} min par semaine
          </Text>
        </div>
        {calculation && (
          <Text role="status" size="sm" c="dimmed">
            Calcul du prix de votre sélection…
          </Text>
        )}
        {current?.error && (
          <div role="alert" className="flex flex-col gap-2">
            <Text size="sm" c="red">
              Le prix n’a pas pu être calculé. Votre sélection est conservée.
            </Text>
            <Button variant="default" className="self-start" onClick={() => setCalculationAttempt((n) => n + 1)}>
              Réessayer le calcul
            </Button>
          </div>
        )}
        {!result && !calculation && !current?.error && (
          <Text size="sm" c="dimmed">
            {studentIds.length === 0
              ? "Choisissez d’abord un danseur."
              : "Choisissez au moins un cours pour connaître le prix."}
          </Text>
        )}
        {result?.status === "invalid" && (
          <Text role="alert" size="sm">
            {result.message}
          </Text>
        )}
        {next?.status === "error" && (
          <Text role="alert" size="sm">
            {next.error.message}
          </Text>
        )}
        {next?.status === "ok" && (
          <dl className="flex flex-col gap-1">
            <div className="flex justify-between gap-2">
              <dt>Forfait {next.packageLabel}</dt>
              <dd className="tabular-nums">{formatEuros(next.grossPriceCents)}</dd>
            </div>
            {next.discounts.map((r) => (
              <Text component="div" size="sm" key={r.code} c={r.status === "rejected" ? "dimmed" : undefined}>
                <div className="flex justify-between gap-2">
                  <dt>
                    Réduction {r.code}
                    {r.status === "rejected" ? " (écartée)" : ""}
                  </dt>
                  <dd className="tabular-nums">{r.status === "applied" ? `−${formatEuros(r.amountCents)}` : "—"}</dd>
                </div>
                <Text size="xs">{r.reason}</Text>
              </Text>
            ))}
            <Text
              component="div"
              size="md"
              fw={600}
              className="mt-2 flex justify-between gap-2 border-t border-bordure pt-3"
            >
              <dt>Total</dt>
              <dd className="tabular-nums">{formatEuros(next.netPriceCents)}</dd>
            </Text>
          </dl>
        )}
        {result?.status === "ok" &&
          result.existingImpacts.map((a) => (
            <Alert key={a.reference} color="yellow" p="xs">
              <Text size="xs">
                L’inscription déjà enregistrée de {a.students} aurait une remise de{" "}
                {formatEuros(a.recalculatedDiscount)} au lieu de {formatEuros(a.savedDeposit)} : à régulariser par un
                avoir si l’école le décide.
              </Text>
            </Alert>
          ))}
        {refusal && (
          <Text role="alert" size="sm" c="red">
            {refusal}
          </Text>
        )}
        <Button type="submit" disabled={!canSave} loading={sending}>
          Enregistrer l’inscription
        </Button>
        <Text size="xs" c="dimmed">
          Vérifiez le prix avant d’enregistrer. Aucun paiement n’est encaissé à cette étape.
        </Text>
        <Text size="xs" c="dimmed" ta="center" className="hidden sm:block">
          ou Ctrl + Entrée
        </Text>
      </Paper>
    </form>
  );
}
