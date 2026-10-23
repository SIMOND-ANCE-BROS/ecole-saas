"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Preview } from "@/db/enrollments";
import type { ScheduleCourse } from "@/db/schedule";
import { overlaps } from "@/domain/schedule/overlap";
import { formatEuros } from "@/lib/money";
import { deferredQuery } from "@/lib/deferred-query";
import { preview, enroll, type FormInput } from "./actions";

const DAYS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const AUDIENCES = [
  ["enfant", "Enfant"],
  ["adulte", "Adulte"],
  ["couple", "Couple"],
  ["etudiant", "Étudiant"],
] as const;
const PERIODS = [
  ["trimestre", "Trimestre"],
  ["annee", "Année"],
] as const;

type Props = {
  payerId: string;
  students: { id: string; firstName: string; age: number | null }[];
  courses: ScheduleCourse[];
  /** Student chosen in advance (« Inscrire » button on their record). */
  initialStudent?: string;
};

export function EnrollmentForm({
  payerId: payerId,
  students: students,
  courses: cours,
  initialStudent: initialStudent,
}: Props) {
  const initial = students.find((d) => d.id === initialStudent) ?? (students.length === 1 ? students[0] : undefined);
  const [studentIds, setStudentIds] = useState<string[]>(initial ? [initial.id] : []);
  const [chosenAudience, setPublic] = useState<FormInput["audience"]>(
    initial && initial.age !== null && initial.age >= 18 ? "adulte" : "enfant",
  );
  const [period, setPeriod] = useState<FormInput["period"]>("trimestre");
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
      payerId: payerId,
      studentIds: studentIds,
      audience: chosenAudience,
      period: period,
      courseIds: courseIds,
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
  const visibleCourses = cours.filter((c) =>
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
  const chosen = cours.filter((c) => courseIds.includes(c.id));
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
        startSend(async () => setRefusal((await enroll(entry)).message));
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
              <a
                href={`#${step.target}`}
                className={`flex h-full items-center gap-2 rounded-md border px-3 py-2 ${step.full ? "border-accent bg-accent-doux" : "border-bordure bg-surface text-doux"}`}
              >
                <span aria-hidden className="font-semibold">
                  {index + 1}
                </span>
                <span>{step.title}</span>
                {step.full && <span className="sr-only"> : renseigné</span>}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex min-w-0 flex-col gap-4">
        <legend className="sr-only">Choix de l’inscription</legend>
        <fieldset id="choix-danseur" className="panneau flex flex-col gap-2 p-3">
          <legend className="text-sm font-semibold">Danseur{chosenAudience === "couple" ? "s (deux)" : ""}</legend>
          {students.map((d) => (
            <label key={d.id} className="flex items-center gap-2 text-sm">
              <input
                type={chosenAudience === "couple" ? "checkbox" : "radio"}
                name="danseur"
                checked={studentIds.includes(d.id)}
                onChange={() => setStudentIds(chosenAudience === "couple" ? toggle(studentIds, d.id) : [d.id])}
              />
              {d.firstName}
              {d.age !== null && <span className="text-doux">({d.age} ans)</span>}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="public" className="text-sm font-semibold">
              Public
            </label>
            <select
              id="public"
              className="champ"
              value={chosenAudience}
              onChange={(e) => {
                const value = e.target.value as FormInput["audience"];
                setPublic(value);
                if (value !== "couple") setStudentIds(studentIds.slice(0, 1));
              }}
            >
              {AUDIENCES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="periodicite" className="text-sm font-semibold">
              Périodicité
            </label>
            <select
              id="periodicite"
              className="champ"
              value={period}
              onChange={(e) => setPeriod(e.target.value as FormInput["period"])}
            >
              {PERIODS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset id="choix-cours" className="flex flex-col gap-2">
          <legend className="text-sm font-semibold">
            Cours ({courseIds.length} choisi{courseIds.length > 1 ? "s" : ""})
          </legend>
          <label className="sr-only" htmlFor="filtre-cours">
            Filtrer les cours
          </label>
          <input
            id="filtre-cours"
            type="search"
            className="champ max-w-xs"
            placeholder="Filtrer : jazz, mercredi, adultes…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <ul className="panneau flex max-h-96 flex-col overflow-y-auto">
            {sortedCourses.length === 0 && (
              <li className="flex flex-col items-start gap-2 p-3 text-doux">
                <p>
                  {cours.length === 0
                    ? "Aucun cours n’est disponible pour cette saison."
                    : "Aucun cours ne correspond à votre recherche."}
                </p>
                {filter && (
                  <button type="button" className="bouton-secondaire" onClick={() => setFilter("")}>
                    Effacer le filtre
                  </button>
                )}
              </li>
            )}
            {sortedCourses.map((c) => {
              const restantes = c.maxCapacity === null ? null : c.maxCapacity - c.enrolled;
              return (
                <li key={c.id} className={`border-b border-bordure last:border-0 ${adapted(c) ? "" : "opacity-60"}`}>
                  <label className="flex items-start gap-2 px-2 py-2 text-sm hover:bg-accent-doux/40 sm:items-center sm:py-1">
                    <input
                      type="checkbox"
                      className="mt-0.5 sm:mt-0"
                      checked={courseIds.includes(c.id)}
                      onChange={() => setCourseIds(toggle(courseIds, c.id))}
                    />
                    <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                      <span className="w-20 shrink-0">{c.weekday ? DAYS[c.weekday] : "Stage"}</span>
                      <span className="w-12 shrink-0 tabular-nums">{c.startTime}</span>
                      <span className="font-medium">{c.discipline}</span>
                      <span className="basis-full text-doux sm:basis-auto">
                        {c.durationMinutes} min{c.level ? `, ${c.level}` : ""}, {c.room}
                        {!adapted(c) && ", hors tranche d’âge"}
                      </span>
                    </span>
                    {restantes !== null && (
                      <span
                        className={`shrink-0 text-xs tabular-nums ${restantes <= 0 ? "rounded bg-alerte-fond px-1.5 font-medium text-alerte-texte" : "text-doux"}`}
                      >
                        {restantes <= 0 ? "complet" : `${restantes} place${restantes > 1 ? "s" : ""}`}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
          {chosen.length > 0 && (
            <ul aria-label="Cours choisis" className="flex flex-wrap gap-1.5">
              {chosen.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="rounded-md border border-accent bg-accent-doux px-2 py-0.5 text-xs hover:border-accent-fort"
                    onClick={() => setCourseIds(courseIds.filter((x) => x !== c.id))}
                    aria-label={`Retirer ${c.discipline} ${c.weekday ? DAYS[c.weekday] : ""} ${c.startTime}`}
                  >
                    {c.discipline} {c.weekday ? DAYS[c.weekday].slice(0, 3).toLowerCase() + "." : ""} {c.startTime} ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {overlappingCourses.length > 0 && (
            <p role="alert" className="rounded-md bg-alerte-fond px-2 py-1 text-xs text-alerte-texte">
              Horaires qui se chevauchent : {overlappingCourses.join(" ; ")}.
            </p>
          )}
        </fieldset>
      </div>

      <aside
        id="prix-inscription"
        aria-live="polite"
        aria-busy={calculation}
        className="panneau flex flex-col gap-3 self-start p-3 text-sm lg:sticky lg:top-16"
      >
        <h2 className="font-semibold">Récapitulatif de l’inscription</h2>
        <div className="border-b border-bordure pb-3 text-xs text-doux">
          <p className="text-sm font-medium text-texte">
            {students
              .filter((d) => studentIds.includes(d.id))
              .map((d) => d.firstName)
              .join(" et ") || "Aucun danseur sélectionné"}
          </p>
          <p>
            {AUDIENCES.find(([v]) => v === chosenAudience)?.[1]} · {PERIODS.find(([v]) => v === period)?.[1]}
          </p>
          <p>
            {chosen.length} cours · {chosen.reduce((total, c) => total + c.durationMinutes, 0)} min par semaine
          </p>
        </div>
        {calculation && (
          <p role="status" className="text-doux">
            Calcul du prix de votre sélection…
          </p>
        )}
        {current?.error && (
          <div role="alert" className="flex flex-col gap-2 text-erreur">
            <p>Le prix n’a pas pu être calculé. Votre sélection est conservée.</p>
            <button
              type="button"
              className="bouton-secondaire self-start"
              onClick={() => setCalculationAttempt((n) => n + 1)}
            >
              Réessayer le calcul
            </button>
          </div>
        )}
        {!result && !calculation && !current?.error && (
          <p className="text-doux">
            {studentIds.length === 0
              ? "Choisissez d’abord un danseur."
              : "Choisissez au moins un cours pour connaître le prix."}
          </p>
        )}
        {result?.status === "invalide" && <p role="alert">{result.message}</p>}
        {next?.status === "erreur" && <p role="alert">{next.error.message}</p>}
        {next?.status === "ok" && (
          <dl className="flex flex-col gap-1">
            <div className="flex justify-between gap-2">
              <dt>Forfait {next.packageLabel}</dt>
              <dd className="tabular-nums">{formatEuros(next.grossPriceCents)}</dd>
            </div>
            {next.discounts.map((r) => (
              <div key={r.code} className={r.status === "ecartee" ? "text-doux" : ""}>
                <div className="flex justify-between gap-2">
                  <dt>
                    Réduction {r.code}
                    {r.status === "ecartee" ? " (écartée)" : ""}
                  </dt>
                  <dd className="tabular-nums">{r.status === "appliquee" ? `−${formatEuros(r.amountCents)}` : "—"}</dd>
                </div>
                <p className="text-xs">{r.pattern}</p>
              </div>
            ))}
            <div className="mt-2 flex justify-between gap-2 border-t border-bordure pt-3 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatEuros(next.netPriceCents)}</dd>
            </div>
          </dl>
        )}
        {result?.status === "ok" &&
          result.existingImpacts.map((a) => (
            <p key={a.reference} className="rounded bg-alerte-fond p-2 text-xs text-alerte-texte">
              L’inscription déjà enregistrée de {a.students} aurait une remise de {formatEuros(a.recalculatedDiscount)}{" "}
              au lieu de {formatEuros(a.savedDeposit)} : à régulariser par un avoir si l’école le décide.
            </p>
          ))}
        {refusal && (
          <p role="alert" className="text-erreur">
            {refusal}
          </p>
        )}
        <button type="submit" className="bouton-principal" disabled={!canSave}>
          {sending ? "Enregistrement…" : "Enregistrer l’inscription"}
        </button>
        <p className="text-xs text-doux">
          Vérifiez le prix avant d’enregistrer. Aucun paiement n’est encaissé à cette étape.
        </p>
        <p className="hidden text-center text-xs text-doux sm:block">ou Ctrl + Entrée</p>
      </aside>
    </form>
  );
}
