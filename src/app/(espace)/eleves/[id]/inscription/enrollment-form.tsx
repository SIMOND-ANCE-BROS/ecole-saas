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
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { Preview } from "@/db/enrollments";
import type { ScheduleCourse } from "@/db/schedule";
import { overlaps } from "@/domain/schedule/overlap";
import { INITIAL_STATUSES, isFull, overfilledCourses } from "@/domain/enrollment/lifecycle";
import { alreadyTaken, DUPLICATE_POLICY, duplicateRefusal, type TakenCourse } from "@/domain/enrollment/duplicates";
import { ENROLLMENT_STATUS_LABELS } from "@/domain/enrollment/statuses";
import { deferredQuery } from "@/lib/deferred-query";
import { formatEuros } from "@/lib/money";
import { quarterMonths, seasonDueCents } from "@/domain/enrollment/quarters";
import { preview, enroll, type FormInput } from "./actions";
import { ManualPriceField } from "./manual-price-field";
import { readTypedPrice, type TypedPrice } from "@/domain/enrollment/manual-price";
import { orConnectionLost } from "@/lib/action-result";
import { CheckSaved } from "@/app/(espace)/_ui/check-saved";
import { DiscountImpacts, PriceDetail } from "@/app/(espace)/_people/price-detail";
import { dayOf } from "@/app/(espace)/_people/sections";

const DAYS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const AUDIENCES = [
  ["child", "Enfant"],
  ["adult", "Adulte"],
  ["couple", "Couple"],
  ["student", "Étudiant"],
] as const;
const SAVE_BUTTON = "enregistrer-inscription";
const CONFIRM_DUPLICATES = "confirmer-doublon";
/** What the save button says for an enrollment not committed yet. */
const STATUS_SAVE = { trial: "l’inscription à l’essai", waitlist: "l’inscription en attente" } as const;
const PERIODS = [
  ["quarter", "Trimestre"],
  ["year", "Année"],
] as const;

type Props = {
  payerId: string;
  students: { id: string; firstName: string; age: number | null }[];
  courses: ScheduleCourse[];
  /** Courses the payer's students already take this season (#333): marked, and saving them again asks first. */
  taken: TakenCourse[];
  /** Student chosen in advance (« Inscrire » button on their record). */
  initialStudent?: string;
  /** The school has several businesses (#299): each course and each enrollment names its own. */
  severalEntities?: boolean;
  /** Day the payer signed the season's internal rules (#296); null: the box is offered. */
  rulesAcceptedOn?: string | null;
  /** Answers to « Comment nous avez-vous connus ? » the school offers (#296). */
  referrals?: { id: string; label: string }[];
  /** Students who already answered it: not asked again. */
  answered?: string[];
};

export function EnrollmentForm({
  payerId,
  students,
  courses,
  taken,
  initialStudent,
  severalEntities = false,
  rulesAcceptedOn = null,
  referrals = [],
  answered = [],
}: Props) {
  const initial = students.find((d) => d.id === initialStudent) ?? (students.length === 1 ? students[0] : undefined);
  const [studentIds, setStudentIds] = useState<string[]>(initial ? [initial.id] : []);
  const [chosenAudience, setAudience] = useState<FormInput["audience"]>(
    initial && initial.age !== null && initial.age >= 18 ? "adult" : "child",
  );
  const [period, setPeriod] = useState<FormInput["period"]>("quarter");
  const [status, setStatus] = useState<FormInput["status"]>("active");
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
  // Prices typed by the front desk (#292), by enrollment (`typedKey`).
  const [typedPrices, setTypedPrices] = useState<Record<string, TypedPrice>>({});
  const [tried, setTried] = useState(false);
  // Which duplicates the front desk confirmed (#333): another choice asks again.
  const [confirmedDuplicates, setConfirmedDuplicates] = useState<string | null>(null);
  const [duplicateTried, setDuplicateTried] = useState(false);
  // #296: ticked at the desk once the family signed the form (« lu et approuvé »).
  const [rulesSigned, setRulesSigned] = useState(false);
  const [referralId, setReferralId] = useState("");
  const [sending, startSend] = useTransition();
  const router = useRouter();
  // Same key for every attempt of this enrollment: a retry after a lost response enrolls nothing twice (#260).
  // A success leaves the form, so a new enrollment always gets a new key.
  const [key] = useState(() => crypto.randomUUID());

  const entry: FormInput = useMemo(
    () => ({
      payerId,
      studentIds,
      audience: chosenAudience,
      period,
      courseIds,
      status,
    }),
    [payerId, studentIds, chosenAudience, period, courseIds, status],
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
  // One enrollment per business selling the chosen courses (#299), all saved together.
  const news = result?.status === "ok" ? result.newEnrollments : [];
  // Quarters a quarterly enrollment made today covers (#291); none for a yearly one.
  const quarters = result?.status === "ok" ? result.quarters : [];
  // A price typed for one enrollment (#292) belongs to its business, students, formula and
  // courses: another selection shows the computed price again, the typed one comes back with it.
  const typedKey = (n: (typeof news)[number]) =>
    [n.billingEntityId, chosenAudience, period, ...studentIds, ...n.courseIds].join("|");
  const prices = news.map((n) => {
    const computedNetCents = n.price.status === "ok" ? n.price.netPriceCents : null;
    // No package in the grid for these courses: the price is typed directly.
    const offGrid = n.price.status === "error" && n.price.error.code === "missing_combination";
    const typed = typedPrices[typedKey(n)] ?? (offGrid ? { price: "", reason: "" } : null);
    const read = readTypedPrice(computedNetCents, typed);
    return {
      n,
      offGrid,
      computedNetCents,
      typed,
      read,
      netPriceCents: read.differs ? read.cents : computedNetCents,
    };
  });
  const setTyped = (n: (typeof news)[number], typed: TypedPrice | null) =>
    setTypedPrices(({ [typedKey(n)]: _replaced, ...others }) => (typed ? { ...others, [typedKey(n)]: typed } : others));
  const priceable = news.length > 0 && prices.every((p) => p.computedNetCents !== null || p.offGrid);
  const complete = prices.every((p) => p.read.valid);
  const canSave = priceable && !calculation && !sending;
  const manualPrices = prices.flatMap((p) =>
    // Only a price apart from the computed one: kept as computed, it follows a recomputation on save.
    p.typed && p.read.cents !== null && p.read.differs
      ? [{ billingEntityId: p.n.billingEntityId, priceCents: p.read.cents, reason: p.typed.reason }]
      : [],
  );
  // Quarterly (#291): the computed total is one quarter's; the season's follows the quarters.
  const totalLabel =
    quarters.length > 0 ? "Prix par trimestre" : status === "active" ? "Total" : "Total à la confirmation";

  // « Comment nous avez-vous connus ? » (#296): asked while a chosen student has no answer yet.
  const askReferral = referrals.length > 0 && studentIds.some((id) => !answered.includes(id));

  // Courses suited to the chosen student(s)' age first; the others remain selectable.
  const chosenAges = students.filter((d) => studentIds.includes(d.id) && d.age !== null).map((d) => d.age as number);
  const adapted = (c: ScheduleCourse) =>
    chosenAges.length === 0 ||
    chosenAges.every((a) => (c.ageMin === null || a >= c.ageMin) && (c.ageMax === null || a <= c.ageMax));
  const sortedCourses = [...visibleCourses.filter(adapted), ...visibleCourses.filter((c) => !adapted(c))];

  const chosen = courses.filter((c) => courseIds.includes(c.id));
  // #333: chosen courses a chosen student already takes this season (not dropped or ended).
  const duplicates = alreadyTaken(studentIds, courseIds, taken);
  const duplicatesKey = duplicates.map((d) => `${d.studentId}|${d.courseId}`).join(",");
  const duplicatesConfirmed = duplicates.length > 0 && confirmedDuplicates === duplicatesKey;
  const unconfirmed = duplicateTried && !duplicatesConfirmed;
  const takenStatus = (courseId: string) => alreadyTaken(studentIds, [courseId], taken)[0]?.status;
  const courseLabel = (c: ScheduleCourse) =>
    `${c.discipline} ${c.weekday ? DAYS[c.weekday].toLowerCase() : ""} ${c.startTime}`;
  // Q5 (#284): a course this enrollment would overfill proposes the waitlist, never blocks.
  const fullCourses = overfilledCourses(status, chosen, Math.max(studentIds.length, 1));

  // Chosen courses that overlap on the same day.
  const overlappingCourses = chosen.flatMap((a, i) =>
    chosen
      .slice(i + 1)
      .filter((b) => overlaps(a, b))
      .map((b) => `${a.discipline} et ${b.discipline} le ${DAYS[a.weekday ?? 0].toLowerCase()}`),
  );

  return (
    <form
      // The typed price's fields say what is missing themselves, in French (#292).
      noValidate
      className="grid gap-6 lg:grid-cols-[1fr_22rem]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        setRefusal(null);
        if (!complete) {
          // A typed price unreadable or without its reason: the field says why, focus goes to it.
          setTried(true);
          requestAnimationFrame(() =>
            document.querySelector<HTMLElement>('#prix-inscription [aria-invalid="true"]')?.focus(),
          );
          return;
        }
        const duplicate = duplicateRefusal(duplicates.length, duplicatesConfirmed);
        if (duplicate) {
          // A course the student already takes (#333): the front desk confirms it last, as the server does.
          if (DUPLICATE_POLICY === "refuse") return setRefusal(duplicate);
          setDuplicateTried(true);
          requestAnimationFrame(() => document.getElementById(CONFIRM_DUPLICATES)?.focus());
          return;
        }
        startSend(async () => {
          const { message } = await orConnectionLost(
            () =>
              enroll(
                {
                  ...entry,
                  manualPrices,
                  duplicatesConfirmed,
                  rulesSigned: rulesAcceptedOn === null && rulesSigned,
                  referralId: askReferral && referralId ? referralId : null,
                },
                key,
              ),
            (message) => ({ message }),
          );
          setRefusal(message);
          // Refused: the courses already taken may have changed since the page loaded (another
          // desk enrolled the student, #333); reloading them shows the confirmation if needed.
          if (message) router.refresh();
        });
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

        <Radio.Group
          id="statut"
          label="Statut"
          description="À l’essai ou en attente : pas encore dû, confirmé plus tard depuis la fiche."
          value={status}
          onChange={(v) => setStatus(v as FormInput["status"])}
        >
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
            {INITIAL_STATUSES.map((s) => (
              <Radio key={s} value={s} label={ENROLLMENT_STATUS_LABELS[s]} />
            ))}
          </div>
        </Radio.Group>

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
              const already = takenStatus(c.id);
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
                            {severalEntities ? ` · ${c.entity}` : ""}
                          </Text>
                          {/* A tag rather than faded text: still readable, still selectable. */}
                          {already && (
                            <Badge color="yellow" variant="light" radius="sm" tt="none" fw={500}>
                              déjà {ENROLLMENT_STATUS_LABELS[already].toLowerCase()}
                            </Badge>
                          )}
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
          {news.length > 1 ? "Récapitulatif des inscriptions" : "Récapitulatif de l’inscription"}
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
          {status !== "active" && (
            <Text size="xs" fw={500}>
              {ENROLLMENT_STATUS_LABELS[status]} : rien à régler pour l’instant ;{" "}
              {prices.some((p) => p.read.differs)
                ? "le prix saisi sera gardé à la confirmation."
                : "le prix sera recalculé à la confirmation."}
            </Text>
          )}
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
        {news.length > 1 && (
          <Alert color="blue" p="xs">
            <Text size="sm">
              {news.length} entreprises différentes : {news.length} inscriptions et {news.length} factures. Le forfait
              se calcule séparément pour chacune.
            </Text>
          </Alert>
        )}
        {prices.map(({ n, offGrid, computedNetCents, typed, read }) => (
          <section
            key={n.billingEntityId}
            aria-label={severalEntities ? `Inscription ${n.entity}` : undefined}
            className="flex flex-col gap-1"
          >
            {severalEntities && (
              <Title order={3} size="sm" fw={700}>
                {n.entity}
              </Title>
            )}
            {n.price.status === "error" ? (
              <Text role={offGrid ? undefined : "alert"} size="sm">
                {n.price.error.message}
              </Text>
            ) : (
              <PriceDetail
                price={n.price}
                // A typed price replaces the computed total, still shown for comparison (#292).
                totalLabel={read.differs ? "Prix calculé" : news.length > 1 ? `Sous-total ${n.entity}` : totalLabel}
                subtotal={news.length > 1 || read.differs}
              />
            )}
            {(computedNetCents !== null || offGrid) && (
              <ManualPriceField
                id={`prix-saisi-${n.billingEntityId}`}
                computedNetCents={computedNetCents}
                typed={typed}
                onChange={(t) => setTyped(n, t)}
                tried={tried}
                quarterCount={quarters.length}
              />
            )}
          </section>
        ))}
        {news.length > 1 && prices.every((p) => p.netPriceCents !== null) && (
          <Text component="div" size="md" fw={600} className="flex justify-between gap-2 border-t border-bordure pt-3">
            <span>
              {quarters.length > 0
                ? "Total par trimestre"
                : status === "active"
                  ? "Total des inscriptions"
                  : "Total à la confirmation"}
            </span>
            <span className="tabular-nums">{formatEuros(prices.reduce((t, p) => t + (p.netPriceCents ?? 0), 0))}</span>
          </Text>
        )}
        {quarters.length > 0 && prices.length > 0 && prices.every((p) => p.netPriceCents !== null) && (
          // Quarterly (#291): the price above is one quarter's, owed for each remaining quarter.
          <div className="flex flex-col gap-1 border-t border-bordure pt-3">
            <Text size="sm">
              {quarters.length === 1 ? "Trimestre restant" : `${quarters.length} trimestres restants`} :{" "}
              {quarters.map((q) => `${q.label} (${quarterMonths(q)})`).join(", ")}
            </Text>
            <Text component="div" size="md" fw={600} className="flex justify-between gap-2">
              <span>{status === "active" ? "Total de la saison" : "Total de la saison, dû à la confirmation"}</span>
              <span className="tabular-nums">
                {formatEuros(
                  prices.reduce(
                    (t, p) =>
                      t +
                      seasonDueCents({
                        period: "quarter",
                        netPriceCents: p.netPriceCents ?? 0,
                        quarterCount: quarters.length,
                      }),
                    0,
                  ),
                )}
              </span>
            </Text>
            <Text size="xs" c="dimmed">
              Un trimestre commencé compte en entier ; chaque trimestre se règle à son début.
            </Text>
          </div>
        )}
        {result?.status === "ok" && <DiscountImpacts impacts={result.existingImpacts} />}
        {refusal && (
          <Text role="alert" size="sm" c="red">
            {refusal}
          </Text>
        )}
        <CheckSaved
          message={refusal}
          href={`/eleves/${studentIds[0] ?? ""}`}
          label="Voir les inscriptions de l’élève"
          safeRetry
        />
        {fullCourses.length > 0 && (
          <Alert role="status" color="yellow" p="xs">
            <Text size="sm" fw={500}>
              {fullCourses.some(isFull)
                ? fullCourses.length > 1
                  ? "Ces cours sont complets"
                  : "Ce cours est complet"
                : "Plus assez de places"}{" "}
              : inscrire en attente ?
            </Text>
            <Text size="xs">{fullCourses.map(courseLabel).join(" ; ")}. « Inscrit » reste possible.</Text>
            <Button
              size="compact-sm"
              variant="default"
              mt="xs"
              onClick={() => {
                setStatus("waitlist");
                // The alert goes with its button: focus moves on to saving.
                requestAnimationFrame(() => document.getElementById(SAVE_BUTTON)?.focus());
              }}
            >
              Inscrire en attente
            </Button>
          </Alert>
        )}
        {duplicates.length > 0 && (
          <Alert role="status" color="yellow" p="xs">
            <Text size="sm" fw={500}>
              Déjà inscrit à {duplicates.length > 1 ? "ces cours" : "ce cours"} cette saison
            </Text>
            <Text component="ul" size="xs">
              {duplicates.map((d) => {
                const c = courses.find((x) => x.id === d.courseId);
                const who = students.find((x) => x.id === d.studentId)?.firstName;
                return (
                  <li key={`${d.studentId}|${d.courseId}`}>
                    {studentIds.length > 1 && who ? `${who} : ` : ""}
                    {c ? courseLabel(c) : ""} ({ENROLLMENT_STATUS_LABELS[d.status].toLowerCase()})
                  </li>
                );
              })}
            </Text>
            {DUPLICATE_POLICY === "warn" && (
              <>
                <Checkbox
                  id={CONFIRM_DUPLICATES}
                  mt="xs"
                  size="xs"
                  radius="xs"
                  label="Inscrire quand même une deuxième fois"
                  checked={duplicatesConfirmed}
                  error={unconfirmed}
                  aria-invalid={unconfirmed}
                  aria-describedby={unconfirmed ? `${CONFIRM_DUPLICATES}-erreur` : undefined}
                  onChange={(e) => setConfirmedDuplicates(e.currentTarget.checked ? duplicatesKey : null)}
                />
                {unconfirmed && (
                  <Text id={`${CONFIRM_DUPLICATES}-erreur`} size="xs" c="red" mt={4}>
                    Cochez pour confirmer, ou retirez ce cours de la sélection.
                  </Text>
                )}
              </>
            )}
            <Button
              size="compact-sm"
              variant="default"
              mt="xs"
              onClick={() => {
                const twice = new Set(duplicates.map((d) => d.courseId));
                setCourseIds(courseIds.filter((id) => !twice.has(id)));
                requestAnimationFrame(() => document.getElementById("filtre-cours")?.focus());
              }}
            >
              {duplicates.length > 1 ? "Retirer ces cours de la sélection" : "Retirer ce cours de la sélection"}
            </Button>
          </Alert>
        )}
        <div className="flex flex-col gap-2 border-t border-bordure pt-3">
          {rulesAcceptedOn ? (
            <Text size="sm">Règlement intérieur signé le {dayOf(rulesAcceptedOn)}.</Text>
          ) : (
            <Checkbox
              id="reglement-signe"
              label="Règlement intérieur signé"
              description="« Lu et approuvé » sur la fiche d’inscription, droit à l’image compris."
              checked={rulesSigned}
              onChange={(e) => setRulesSigned(e.currentTarget.checked)}
            />
          )}
          {askReferral && (
            <NativeSelect
              id="connu-par"
              label="Comment nous avez-vous connus ?"
              description="Facultatif"
              value={referralId}
              data={[{ value: "", label: "Non renseigné" }, ...referrals.map((r) => ({ value: r.id, label: r.label }))]}
              onChange={(e) => setReferralId(e.currentTarget.value)}
            />
          )}
        </div>
        <Button id={SAVE_BUTTON} type="submit" disabled={!canSave} loading={sending}>
          {news.length > 1
            ? `Enregistrer les ${news.length} inscriptions${status === "active" ? "" : ` (${ENROLLMENT_STATUS_LABELS[status].toLowerCase()})`}`
            : status === "active"
              ? "Enregistrer l’inscription"
              : `Enregistrer ${STATUS_SAVE[status]}`}
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
