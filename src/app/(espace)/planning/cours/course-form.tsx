"use client";

import { Alert, Autocomplete, Button, Fieldset, Group, NumberInput, Select, Text, TextInput } from "@mantine/core";
import { TimeInput } from "@mantine/dates";
import { useEffect, useRef, useState, useTransition } from "react";
import { type CoursePay, type EditedCourse, RECURRENCES, type ScheduleReferential, COURSE_TYPES } from "@/db/courses";
import { PAY_UNITS, rateField } from "@/domain/payroll/rate-field";
import { formatEuros, parseEuros, typedEuros } from "@/lib/money";
import type { ScheduleCourse } from "@/db/schedule";
import { conflicts } from "@/domain/schedule/overlap";
import { lessonDatesOf, type SeasonCalendar } from "@/domain/schedule/lessons";
import { outsideHours } from "@/domain/schedule/hours";
import { saveCourse, type Refusal, remove, checkSlot } from "./actions";
import { Cancel } from "@/app/(espace)/_panel/panel";
import { DateField, refusedDateField } from "@/app/(espace)/_ui/date-field";
import { TextLink } from "@/app/(espace)/_ui/text-link";
import { CONNECTION_LOST, NOT_SAVED, orNotSaved } from "@/lib/action-result";
import { CheckSaved } from "@/app/(espace)/_ui/check-saved";

const DAYS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const DURATIONS = [45, 60, 90, 120];
const NEW = "new";
const shortDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

type Props = {
  course: EditedCourse | null;
  referential: ScheduleReferential;
  /** Instructors' pay modes and this course's own rate (#191): director pages only. */
  pay: CoursePay;
  schedule: ScheduleCourse[];
  /** Season dates and closures: overlaps are checked on actual lesson dates (#96). */
  calendar: SeasonCalendar | null;
  /** Day suggested for a new course (« + » link of a schedule column). */
  day?: number;
  /** Slot suggested from the calendar view. */
  startTime?: string;
  duration?: number;
  /** Date clicked in the dated schedule: first date if « à des dates précises » is chosen. */
  date?: string;
  /** Room of the column clicked in the « Par salle » view (#85); ignored if unknown. */
  room?: string;
  /** Season of a new course, chosen on the planning (#189); ignored when editing. */
  seasonId?: string;
  /** Planning of that season, where « Annuler » goes back for a new course. */
  planning?: string;
};

const whole = (v: string) => (v.trim() === "" ? null : Number(v));

export function CourseForm({
  course,
  referential: referential,
  pay,
  schedule: schedule,
  calendar,
  day: day,
  startTime,
  duration: duration,
  date,
  room,
  seasonId,
  planning = "/planning",
}: Props) {
  const r = referential;
  const [v, setV] = useState({
    discipline: course?.discipline ?? "",
    roomId: course?.roomId ?? r.rooms.find((s) => s.id === room)?.id ?? r.rooms[0]?.id ?? NEW,
    newRoom: "",
    roomCapacity: "",
    siteId: r.sites[0]?.id ?? NEW,
    newSite: "",
    siteAddress: "",
    instructorId: course?.instructorId ?? r.instructors[0]?.id ?? "",
    type: course?.type ?? "group",
    recurrence: course?.recurrence ?? "weekly",
    startDate: course?.startDate ?? "",
    endDate: course?.endDate ?? "",
    weekday: String(course?.weekday ?? day ?? 1),
    startTime: course?.startTime ?? startTime ?? "17:00",
    durationMinutes: String(course?.durationMinutes ?? duration ?? 60),
    ageMin: course?.ageMin?.toString() ?? "",
    ageMax: course?.ageMax?.toString() ?? "",
    level: course?.level ?? "",
    maxCapacity: course?.maxCapacity?.toString() ?? "",
    instructorRate: pay.rate === null ? "" : typedEuros(pay.rate.cents),
  });
  // Dates of a one-off course; one empty row to start with.
  const [dates, setDates] = useState<string[]>(course?.dates.length ? course.dates : [date ?? ""]);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [sending, startTransition] = useTransition();
  // Same key for every attempt of a new course: a retry after a lost response creates it once (#260).
  // A success leaves the form, so another new course always gets a new key.
  const [submissionKey] = useState(() => crypto.randomUUID());
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (refusal) form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [refusal]);
  const [confirmDeletion, setConfirm] = useState(false);
  // A rate typed for the previous instructor, removed when another one was chosen: said in an alert.
  const [rateCleared, setRateCleared] = useState<{ amount: string; instructor: string } | null>(null);
  // « Convertir au mode actuel »: an older pay mode's rate kept as the same amount in the current one (#268).
  const [convertRate, setConvertRate] = useState(false);
  const set = (field: keyof typeof v) => (value: string | number | null) =>
    setV({ ...v, [field]: value === null ? "" : String(value) });
  const typed = (field: keyof typeof v) => (e: { currentTarget: { value: string } }) =>
    set(field)(e.currentTarget.value);

  const oneOff = v.recurrence === "dates";
  const chosenRoom = r.rooms.find((s) => s.id === v.roomId);
  const existingDiscipline = r.disciplines.find((d) => d.name.toLowerCase() === v.discipline.trim().toLowerCase());
  const typedDiscipline = v.discipline.trim().toLowerCase();
  // Mantine highlights the first option containing the text, in list order.
  const firstMatch = r.disciplines.find((d) => d.name.toLowerCase().includes(typedDiscipline));
  const startsADiscipline = typedDiscipline !== "" && !!firstMatch?.name.toLowerCase().startsWith(typedDiscipline);

  const instructorPay = pay.instructors[v.instructorId];
  const savedRate = pay.rate === null ? "" : typedEuros(pay.rate.cents);
  // What the rate field shows and sends (#191, #268): see rateField.
  const {
    allowed: rateAllowed,
    unused: unusedRate,
    oldUnit,
    shownUnit,
    sent: sentRate,
  } = rateField({
    payMode: instructorPay?.payMode,
    ownInstructor: course?.instructorId === v.instructorId,
    saved: pay.rate,
    typed: v.instructorRate,
    convert: convertRate,
  });
  const nameOf = (id: string) => r.instructors.find((i) => i.id === id);
  // « 45,50 € / heure » for the amount in the field; the text as typed if it is not an amount.
  const shownAmount = (typedAmount: string) => {
    const cents = parseEuros(typedAmount);
    return cents === null || !shownUnit ? typedAmount : `${formatEuros(cents)} / ${PAY_UNITS[shownUnit]}`;
  };

  const entry = {
    discipline: existingDiscipline ? { id: existingDiscipline.id } : { name: v.discipline },
    room:
      v.roomId !== NEW
        ? { id: v.roomId }
        : {
            name: v.newRoom,
            capacity: whole(v.roomCapacity),
            site: v.siteId !== NEW ? { id: v.siteId } : { name: v.newSite, address: v.siteAddress },
          },
    instructorId: v.instructorId,
    type: v.type,
    recurrence: v.recurrence,
    weekday: oneOff ? null : Number(v.weekday),
    startDate: oneOff || !v.startDate ? null : v.startDate,
    endDate: oneOff || !v.endDate ? null : v.endDate,
    dates: oneOff ? dates.filter(Boolean) : [],
    startTime: v.startTime,
    durationMinutes: Number(v.durationMinutes),
    ageMin: whole(v.ageMin),
    ageMax: whole(v.ageMax),
    level: v.level,
    maxCapacity: whole(v.maxCapacity),
    // Not offered for a monthly flat instructor: nothing is sent, so no rate is kept (#192).
    instructorRate: sentRate,
    // The instructor this rate was typed for: a rate left over from another one is not kept.
    instructorRateFor: sentRate === undefined ? undefined : v.instructorId,
    // The unit shown with that amount: the server refuses one the instructor is no longer paid in (#268).
    instructorRateUnit: sentRate === undefined ? undefined : (shownUnit ?? undefined),
  };

  const roomSite = r.rooms.find((s) => s.id === v.roomId)?.siteId;
  const datesOf = (c: Parameters<typeof lessonDatesOf>[0]) => (calendar ? lessonDatesOf(c, calendar) : undefined);
  const overlaps = conflicts(
    {
      id: course?.id ?? null,
      weekday: entry.weekday,
      startTime: v.startTime,
      durationMinutes: entry.durationMinutes || 0,
      roomId: v.roomId,
      instructorId: v.instructorId,
      // Its own site and course closures apply too (#200).
      lessonDates: datesOf({ ...entry, id: course?.id ?? null, siteId: roomSite }),
    },
    schedule.map((c) => ({ ...c, lessonDates: datesOf(c) })),
  ).map((c) => {
    const other = schedule.find((p) => p.id === c.id)!;
    const when = `${other.discipline} à ${other.startTime}`;
    if (c.room && c.instructor) return `${other.room} et ${other.instructor} déjà pris (${when})`;
    return c.room ? `${other.room} déjà occupée (${when})` : `${other.instructor} donne déjà un cours (${when})`;
  });

  // Slot outside the opening hours of the room's site (warning only: an exceptional course is still allowed).
  const outsideOpening =
    !oneOff && roomSite && entry.weekday && entry.durationMinutes > 0
      ? outsideHours(
          { weekday: entry.weekday, startTime: v.startTime, durationMinutes: entry.durationMinutes },
          r.hours[roomSite] ?? [],
        )
      : null;

  // Instructor unavailabilities on the slot's upcoming dates, checked server-side after a pause.
  const [unavailabilityDates, setUnavailabilityDates] = useState<string[]>([]);
  const key = oneOff ? "" : `${v.instructorId}|${v.weekday}|${v.startTime}|${v.durationMinutes}`;
  useEffect(() => {
    if (!key) return;
    const [instructorId, day, time, duration] = key.split("|");
    const timer = setTimeout(() => {
      // A failed check shows no warning rather than an unhandled error.
      checkSlot(
        course?.id ?? null,
        {
          instructorId,
          weekday: Number(day),
          startTime: time,
          durationMinutes: Number(duration),
        },
        seasonId,
      ).then(setUnavailabilityDates, () => setUnavailabilityDates([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [key, course?.id, seasonId]);
  const displayedUnavailability = key ? unavailabilityDates : [];
  const chosenInstructor = r.instructors.find((i) => i.id === v.instructorId);

  const error = (field: keyof Refusal["errors"]) => refusal?.errors[field];
  const newRoomError = (
    ["room.name", "room.capacity", "room.site", "room.site.name", "room.site.address"] as const
  ).some((k) => error(k));
  const options = (labels: Record<string, string>) =>
    Object.entries(labels).map(([value, label]) => ({ value, label }));

  return (
    <form
      ref={form}
      className="flex w-full min-w-0 flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        // A date shown as refused is never saved as empty or dropped from the list.
        if (refusedDateField(e.currentTarget)) return;
        startTransition(async () =>
          setRefusal(
            await orNotSaved(
              () => saveCourse(course?.id ?? null, entry, seasonId, submissionKey),
              // A new course may have been created before the answer was lost: check before retrying.
              () => ({ message: course ? NOT_SAVED : CONNECTION_LOST, errors: {} }),
            ),
          ),
        );
      }}
    >
      <Fieldset legend="Cours" className="grid gap-3 sm:grid-cols-2">
        <Autocomplete
          label="Discipline"
          autoComplete="off"
          autoFocus={!course}
          data={r.disciplines.map((d) => d.name)}
          // « Ja » then Enter takes « Jazz » rather than creating « Ja »; a new
          // « Jazz » is not replaced by « Modern jazz », which only contains it.
          selectFirstOptionOnChange={startsADiscipline}
          // Opens on a click, typing or ArrowDown, not on mere focus (#258): the panel opens
          // with focus here, and the first Escape must close the panel, not a list.
          openOnFocus={false}
          value={v.discipline}
          onChange={set("discipline")}
          description={
            v.discipline.trim() && !existingDiscipline ? "Nouvelle discipline : elle sera créée." : undefined
          }
          error={v.discipline.trim() && !existingDiscipline ? undefined : error("discipline")}
        />
        <TextInput
          label="Niveau (facultatif)"
          autoComplete="off"
          placeholder="Débutant, Adultes…"
          value={v.level}
          onChange={typed("level")}
        />
        <Select
          label="Intervenant"
          allowDeselect={false}
          searchable
          data={r.instructors.map((i) => ({
            value: i.id,
            label: `${i.firstName} ${i.name}${i.active ? "" : " (inactif)"}`,
          }))}
          value={v.instructorId || null}
          // The rate typed for this course was the previous instructor's: it goes with them.
          onChange={(value) => {
            if (!value || value === v.instructorId) return;
            // Back to the course's own instructor: their saved rate comes back.
            if (value === course?.instructorId) {
              setRateCleared(null);
              setConvertRate(false);
              setV({
                ...v,
                instructorId: value,
                instructorRate: savedRate,
              });
              return;
            }
            const previous = nameOf(v.instructorId);
            const typedAmount = v.instructorRate.trim();
            setRateCleared(
              typedAmount && previous
                ? {
                    amount: shownAmount(typedAmount),
                    instructor: `${previous.firstName} ${previous.name}`,
                  }
                : null,
            );
            setV({ ...v, instructorId: value, instructorRate: "" });
          }}
          description={
            r.instructors.length === 0 ? (
              <>
                Aucun intervenant actif : <TextLink href="/intervenants/nouveau">en ajouter un</TextLink>.
              </>
            ) : undefined
          }
          error={error("instructorId")}
        />
        <div>
          {instructorPay &&
            (rateAllowed || unusedRate ? (
              <TextInput
                label="Tarif intervenant pour ce cours"
                // Description under the field: its box lines up with « Intervenant ».
                inputWrapperOrder={["label", "input", "description", "error"]}
                description={
                  !rateAllowed
                    ? "Ce tarif ne s’applique pas pour l’instant (forfait mensuel, règle en attente)."
                    : oldUnit
                      ? `Tarif de l’ancien mode de rémunération, gardé tel quel. Pour le passer en € / ${PAY_UNITS[instructorPay.payMode]}, saisissez le montant voulu. Vide : tarif habituel de ${nameOf(v.instructorId)?.firstName ?? "l’intervenant"}, ${formatEuros(instructorPay.rateCents)} / ${PAY_UNITS[instructorPay.payMode]}.`
                      : `Vide : tarif habituel de ${nameOf(v.instructorId)?.firstName ?? "l’intervenant"}, ${formatEuros(instructorPay.rateCents)} / ${PAY_UNITS[instructorPay.payMode]}.`
                }
                inputMode="decimal"
                autoComplete="off"
                rightSection={
                  <Text size="xs" c="dimmed" pr="xs">
                    {rateAllowed && shownUnit ? `€ / ${PAY_UNITS[shownUnit]}` : "€"}
                  </Text>
                }
                rightSectionWidth={90}
                styles={{ input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
                value={v.instructorRate}
                onChange={(e) => {
                  setRateCleared(null);
                  typed("instructorRate")(e);
                }}
                error={error("instructorRate")}
              />
            ) : (
              <Text size="sm" c="dimmed" pt={{ base: 0, sm: 28 }}>
                Pas de tarif par cours pour un forfait mensuel pour l’instant (règle en attente).
              </Text>
            ))}
          {instructorPay && oldUnit && (
            // The same amount, now in the current pay mode: said on purpose, never by retyping it.
            <Button variant="subtle" size="compact-xs" mt={4} onClick={() => setConvertRate(true)}>
              Convertir au mode actuel ({pay.rate && formatEuros(pay.rate.cents)} / {PAY_UNITS[instructorPay.payMode]})
            </Button>
          )}
          <div aria-live="polite">
            {rateCleared && (
              <Alert color="yellow" role="status" mt="xs" p="xs">
                Le tarif de {rateCleared.amount} saisi pour {rateCleared.instructor} a été retiré : il ne vaut que pour
                cet intervenant.
              </Alert>
            )}
          </div>
        </div>
        <Select
          label="Type"
          allowDeselect={false}
          data={options(COURSE_TYPES)}
          value={v.type}
          onChange={(value) => {
            const type = (value ?? v.type) as typeof v.type;
            // A new workshop usually has specific dates.
            setV({ ...v, type, recurrence: !course && type === "workshop" ? "dates" : v.recurrence });
          }}
        />
      </Fieldset>

      <Fieldset legend="Créneau" className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Récurrence"
          className="sm:col-span-3 sm:max-w-xs"
          allowDeselect={false}
          data={options(RECURRENCES)}
          value={v.recurrence}
          onChange={set("recurrence")}
        />
        {oneOff ? (
          <div className="flex flex-col gap-1 sm:col-span-3">
            <Text size="sm" fw={500} id="dates-libelle">
              Dates
            </Text>
            <ul className="flex flex-wrap gap-2" aria-labelledby="dates-libelle">
              {dates.map((d, i) => (
                <li key={i} className="flex items-start gap-1">
                  <DateField
                    aria-label={`Date ${i + 1}`}
                    w={140}
                    value={d}
                    onChange={(value) => setDates(dates.map((x, j) => (j === i ? value : x)))}
                    error={Boolean(error("dates"))}
                  />
                  {dates.length > 1 && (
                    <Button
                      variant="subtle"
                      color="gray"
                      px="xs"
                      aria-label={`Retirer la date ${i + 1}`}
                      onClick={() => setDates(dates.filter((_, j) => j !== i))}
                    >
                      ×
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {error("dates") && (
              <Text size="sm" c="red" role="alert" tabIndex={-1}>
                {error("dates")}
              </Text>
            )}
            <Button variant="subtle" size="compact-sm" className="self-start" onClick={() => setDates([...dates, ""])}>
              Ajouter une date
            </Button>
            <Text size="xs" c="dimmed">
              Les dates précises ne tiennent pas compte des fermetures (un stage peut avoir lieu pendant les vacances).
            </Text>
          </div>
        ) : (
          <Select
            label="Jour"
            allowDeselect={false}
            data={DAYS.slice(1).map((j, i) => ({ value: String(i + 1), label: j }))}
            value={v.weekday}
            onChange={set("weekday")}
          />
        )}
        <TimeInput
          label="Début"
          step={300}
          value={v.startTime}
          onChange={typed("startTime")}
          error={error("startTime")}
        />
        <div className="flex flex-col gap-1">
          <NumberInput
            label="Durée (minutes)"
            min={5}
            step={5}
            allowDecimal={false}
            // No silent correction on blur (0 places → 1): the server says what is wrong.
            clampBehavior="none"
            trimLeadingZeroesOnBlur={false}
            value={v.durationMinutes}
            onChange={set("durationMinutes")}
            error={error("durationMinutes")}
          />
          <Group gap={4} role="group" aria-label="Durées courantes">
            {DURATIONS.map((d) => (
              <Button
                key={d}
                size="compact-xs"
                variant={String(d) === v.durationMinutes ? "filled" : "default"}
                aria-pressed={String(d) === v.durationMinutes}
                onClick={() => setV({ ...v, durationMinutes: String(d) })}
              >
                {d}
              </Button>
            ))}
          </Group>
        </div>
        {!oneOff && (
          <Fieldset
            variant="unstyled"
            className="sm:col-span-3"
            legend={
              <Text span size="sm" fw={500}>
                Période{" "}
                <Text span size="sm" c="dimmed">
                  (facultatif : vide, toute la saison)
                </Text>
              </Text>
            }
          >
            <Group align="flex-start" gap="sm">
              <DateField label="Du" w={160} value={v.startDate} onChange={set("startDate")} />
              <DateField label="Au" w={160} value={v.endDate} onChange={set("endDate")} error={error("endDate")} />
            </Group>
          </Fieldset>
        )}
      </Fieldset>

      <Fieldset legend="Lieu" className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Salle"
          className="sm:col-span-2"
          allowDeselect={false}
          data={[
            ...r.rooms.map((s) => ({
              value: s.id,
              label: `${s.name}, ${s.site}${s.capacity ? ` (${s.capacity} places)` : ""}`,
            })),
            { value: NEW, label: "Nouvelle salle…" },
          ]}
          value={v.roomId}
          onChange={set("roomId")}
          // A new room's errors show under its own fields, when Zod names one.
          error={v.roomId === NEW && newRoomError ? undefined : error("room")}
        />
        {v.roomId === NEW && (
          <>
            <TextInput
              label="Nom de la salle"
              autoComplete="off"
              value={v.newRoom}
              onChange={typed("newRoom")}
              error={error("room.name")}
            />
            <NumberInput
              label="Capacité de la salle (facultatif)"
              min={1}
              allowDecimal={false}
              clampBehavior="none"
              trimLeadingZeroesOnBlur={false}
              value={v.roomCapacity}
              onChange={set("roomCapacity")}
              error={error("room.capacity")}
            />
            <Select
              label="Site"
              className="sm:col-span-2"
              allowDeselect={false}
              data={[...r.sites.map((s) => ({ value: s.id, label: s.name })), { value: NEW, label: "Nouveau site…" }]}
              value={v.siteId}
              onChange={set("siteId")}
              error={v.siteId === NEW ? undefined : error("room.site")}
            />
            {v.siteId === NEW && (
              <>
                <TextInput
                  label="Nom du site"
                  autoComplete="off"
                  value={v.newSite}
                  onChange={typed("newSite")}
                  error={error("room.site.name")}
                />
                <TextInput
                  label="Adresse du site"
                  autoComplete="off"
                  value={v.siteAddress}
                  onChange={typed("siteAddress")}
                  error={error("room.site.address")}
                />
              </>
            )}
          </>
        )}
      </Fieldset>

      <Fieldset legend="Public" className="grid gap-3 sm:grid-cols-3">
        <NumberInput
          label="Âge minimum"
          min={0}
          allowDecimal={false}
          clampBehavior="none"
          trimLeadingZeroesOnBlur={false}
          value={v.ageMin}
          onChange={set("ageMin")}
        />
        <NumberInput
          label="Âge maximum"
          min={0}
          allowDecimal={false}
          clampBehavior="none"
          trimLeadingZeroesOnBlur={false}
          value={v.ageMax}
          onChange={set("ageMax")}
          error={error("ageMax")}
        />
        <NumberInput
          label="Places"
          min={1}
          allowDecimal={false}
          clampBehavior="none"
          trimLeadingZeroesOnBlur={false}
          placeholder={chosenRoom?.capacity ? `${chosenRoom.capacity} (salle)` : "sans limite"}
          value={v.maxCapacity}
          onChange={set("maxCapacity")}
        />
      </Fieldset>

      {displayedUnavailability.length > 0 && (
        <Alert role="status" color="yellow">
          <p className="font-medium">
            {chosenInstructor?.firstName} est indisponible{" "}
            {displayedUnavailability.length > 1 ? `${displayedUnavailability.length} fois` : "une fois"} sur ce créneau
            :
          </p>
          {displayedUnavailability
            .slice(0, 6)
            .map((d) => shortDate.format(new Date(`${d}T00:00:00Z`)))
            .join(", ")}
          {displayedUnavailability.length > 6 && "…"}
        </Alert>
      )}

      {outsideOpening && (
        <Alert role="status" color="yellow">
          {outsideOpening} Le cours reste possible.
        </Alert>
      )}

      {overlaps.length > 0 && (
        <Alert role="status" color="yellow">
          <p className="font-medium">Ce créneau est déjà occupé :</p>
          <ul className="list-disc pl-5">
            {overlaps.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Alert>
      )}

      {refusal && (
        <Text tabIndex={-1} role="alert" size="sm" c="red">
          {refusal.message}
        </Text>
      )}
      <CheckSaved
        message={refusal?.message}
        href={planning ?? "/planning"}
        label="Voir le planning"
        safeRetry={!course}
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-bordure pt-4">
        <Button type="submit" loading={sending}>
          {course ? "Enregistrer les modifications" : "Créer le cours"}
        </Button>
        <Cancel href={course ? `/planning/cours/${course.id}` : planning} />
        {course &&
          (confirmDeletion ? (
            <Group gap="xs" className="ml-auto text-sm">
              <Text span size="sm">
                Supprimer ce cours ?
              </Text>
              <Button
                color="red"
                variant="outline"
                loading={sending}
                onClick={() =>
                  startTransition(async () => {
                    setRefusal(
                      await orNotSaved(
                        () => remove(course.id),
                        () => ({ message: NOT_SAVED, errors: {} }),
                      ),
                    );
                    setConfirm(false);
                  })
                }
              >
                Oui, supprimer
              </Button>
              {/* Focus on the safe answer: keyboard users keep their place and the
                  confirmation, which may wrap below, scrolls into view. */}
              <Button variant="default" autoFocus onClick={() => setConfirm(false)}>
                Non
              </Button>
            </Group>
          ) : (
            <Button variant="subtle" color="red" className="ml-auto" onClick={() => setConfirm(true)}>
              Supprimer le cours
            </Button>
          ))}
      </div>
    </form>
  );
}
