"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { type EditedCourse, RECURRENCES, type ScheduleReferential, COURSE_TYPES } from "@/db/courses";
import type { ScheduleCourse } from "@/db/schedule";
import { conflicts } from "@/domain/schedule/overlap";
import { outsideHours } from "@/domain/schedule/hours";
import { saveCourse, type Refusal, remove, checkSlot } from "./actions";
import { Cancel } from "@/app/(espace)/_panel/panel";

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
  schedule: ScheduleCourse[];
  /** Day suggested for a new course (« + » link of a schedule column). */
  day?: number;
  /** Slot suggested from the calendar view. */
  heure?: string;
  duration?: number;
  /** Date clicked in the dated schedule: first date if « à des dates précises » is chosen. */
  date?: string;
};

const whole = (v: string) => (v.trim() === "" ? null : Number(v));

export function CourseForm({
  course: cours,
  referential: referential,
  schedule: schedule,
  day: day,
  heure,
  duration: duration,
  date,
}: Props) {
  const r = referential;
  const [v, setV] = useState({
    discipline: cours?.discipline ?? "",
    roomId: cours?.roomId ?? r.salles[0]?.id ?? NEW,
    newRoom: "",
    roomCapacity: "",
    siteId: r.sites[0]?.id ?? NEW,
    newSite: "",
    siteAddress: "",
    instructorId: cours?.instructorId ?? r.instructors[0]?.id ?? "",
    type: cours?.type ?? "group",
    recurrence: cours?.recurrence ?? "weekly",
    startDate: cours?.startDate ?? "",
    endDate: cours?.endDate ?? "",
    weekday: String(cours?.weekday ?? day ?? 1),
    startTime: cours?.startTime ?? heure ?? "17:00",
    durationMinutes: String(cours?.durationMinutes ?? duration ?? 60),
    ageMin: cours?.ageMin?.toString() ?? "",
    ageMax: cours?.ageMax?.toString() ?? "",
    level: cours?.level ?? "",
    maxCapacity: cours?.maxCapacity?.toString() ?? "",
  });
  // Dates of a one-off course; one empty row to start with.
  const [dates, setDates] = useState<string[]>(cours?.dates.length ? cours.dates : [date ?? ""]);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [sending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (refusal) form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [refusal]);
  const [confirmDeletion, setConfirm] = useState(false);
  const updated = (field: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [field]: e.target.value });

  const oneOff = v.recurrence === "dates";
  const chosenRoom = r.salles.find((s) => s.id === v.roomId);
  const existingDiscipline = r.disciplines.find((d) => d.name.toLowerCase() === v.discipline.trim().toLowerCase());

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
  };

  const overlaps = conflicts(
    {
      id: cours?.id ?? null,
      weekday: entry.weekday,
      startTime: v.startTime,
      durationMinutes: entry.durationMinutes || 0,
      roomId: v.roomId,
      instructorId: v.instructorId,
    },
    schedule,
  ).map((c) => {
    const other = schedule.find((p) => p.id === c.id)!;
    const when = `${other.discipline} à ${other.startTime}`;
    if (c.room && c.instructor) return `${other.room} et ${other.instructor} déjà pris (${when})`;
    return c.room ? `${other.room} déjà occupée (${when})` : `${other.instructor} donne déjà un cours (${when})`;
  });

  // Slot outside the opening hours of the room's site (warning only: an exceptional course is still allowed).
  const roomSite = r.salles.find((s) => s.id === v.roomId)?.siteId;
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
    const [instructorId, day, heure, duration] = key.split("|");
    const timer = setTimeout(() => {
      // A failed check shows no warning rather than an unhandled error.
      checkSlot(cours?.id ?? null, {
        instructorId,
        weekday: Number(day),
        startTime: heure,
        durationMinutes: Number(duration),
      }).then(setUnavailabilityDates, () => setUnavailabilityDates([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [key, cours?.id]);
  const displayedUnavailability = key ? unavailabilityDates : [];
  const chosenInstructor = r.instructors.find((i) => i.id === v.instructorId);

  const error = (field: keyof Refusal["errors"]) =>
    refusal?.errors[field] && (
      <p id={`${field}-erreur`} className="text-xs text-erreur">
        {refusal.errors[field]}
      </p>
    );
  const invalid = (field: keyof Refusal["errors"]) =>
    refusal?.errors[field] ? { "aria-invalid": true, "aria-describedby": `${field}-erreur` } : {};
  const label = (section: string, text: string) => (
    <label htmlFor={section} className="text-sm font-medium">
      {text}
    </label>
  );

  return (
    <form
      ref={form}
      className="flex w-full min-w-0 flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => setRefusal(await saveCourse(cours?.id ?? null, entry)));
      }}
    >
      <fieldset className="panneau p-4 grid gap-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Cours</legend>
        <div className="flex flex-col gap-1">
          {label("discipline", "Discipline")}
          <input
            id="discipline"
            className="champ"
            list="disciplines"
            autoComplete="off"
            autoFocus={!cours}
            value={v.discipline}
            onChange={updated("discipline")}
            {...invalid("discipline")}
          />
          <datalist id="disciplines">
            {r.disciplines.map((d) => (
              <option key={d.id} value={d.name} />
            ))}
          </datalist>
          {v.discipline.trim() && !existingDiscipline ? (
            <p className="text-xs text-doux">Nouvelle discipline : elle sera créée.</p>
          ) : (
            error("discipline")
          )}
        </div>
        <div className="flex flex-col gap-1">
          {label("niveau", "Niveau (facultatif)")}
          <input
            id="niveau"
            className="champ"
            autoComplete="off"
            placeholder="Débutant, Adultes…"
            value={v.level}
            onChange={updated("level")}
          />
        </div>
        <div className="flex flex-col gap-1">
          {label("intervenant", "Intervenant")}
          <select
            id="intervenant"
            className="champ"
            value={v.instructorId}
            onChange={updated("instructorId")}
            {...invalid("instructorId")}
          >
            {r.instructors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.firstName} {i.name}
                {i.active ? "" : " (inactif)"}
              </option>
            ))}
          </select>
          {r.instructors.length === 0 && (
            <p className="text-xs text-erreur">
              Aucun intervenant actif :{" "}
              <Link href="/intervenants/nouveau" className="lien">
                en ajouter un
              </Link>
              .
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {label("type", "Type")}
          <select
            id="type"
            className="champ"
            value={v.type}
            onChange={(e) => {
              const type = e.target.value as typeof v.type;
              // A new workshop usually has specific dates.
              setV({ ...v, type, recurrence: !cours && type === "workshop" ? "dates" : v.recurrence });
            }}
          >
            {Object.entries(COURSE_TYPES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset className="panneau p-4 grid gap-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">Créneau</legend>
        <div className="flex flex-col gap-1 sm:col-span-3">
          {label("recurrence", "Récurrence")}
          <select id="recurrence" className="champ sm:max-w-xs" value={v.recurrence} onChange={updated("recurrence")}>
            {Object.entries(RECURRENCES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {oneOff ? (
          <div className="flex flex-col gap-1 sm:col-span-3">
            <span className="text-sm font-medium" id="dates-libelle">
              Dates
            </span>
            <ul className="flex flex-wrap gap-2" aria-labelledby="dates-libelle">
              {dates.map((d, i) => (
                <li key={i} className="flex items-center gap-1">
                  <label className="sr-only" htmlFor={`date-${i}`}>
                    Date {i + 1}
                  </label>
                  <input
                    id={`date-${i}`}
                    type="date"
                    className="champ"
                    value={d}
                    onChange={(e) => setDates(dates.map((x, j) => (j === i ? e.target.value : x)))}
                    {...(i === 0 ? invalid("dates") : {})}
                  />
                  {dates.length > 1 && (
                    <button
                      type="button"
                      className="bouton-secondaire px-2"
                      aria-label={`Retirer la date ${i + 1}`}
                      onClick={() => setDates(dates.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" className="lien self-start text-sm" onClick={() => setDates([...dates, ""])}>
              Ajouter une date
            </button>
            {error("dates")}
            <p className="text-xs text-doux">
              Les dates précises ne tiennent pas compte des fermetures (un stage peut avoir lieu pendant les vacances).
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {label("jour", "Jour")}
            <select id="jour" className="champ" value={v.weekday} onChange={updated("weekday")}>
              {DAYS.slice(1).map((j, i) => (
                <option key={j} value={i + 1}>
                  {j}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          {label("heure", "Début")}
          <input
            id="heure"
            type="time"
            step={300}
            className="champ"
            value={v.startTime}
            onChange={updated("startTime")}
            {...invalid("startTime")}
          />
          {error("startTime")}
        </div>
        <div className="flex flex-col gap-1">
          {label("duree", "Durée (minutes)")}
          <input
            id="duree"
            type="number"
            min={5}
            step={5}
            className="champ"
            value={v.durationMinutes}
            onChange={updated("durationMinutes")}
            {...invalid("durationMinutes")}
          />
          <div className="flex gap-1" role="group" aria-label="Durées courantes">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                className={`rounded border px-1.5 text-xs ${String(d) === v.durationMinutes ? "border-accent bg-accent-doux" : "border-bordure text-doux hover:border-accent"}`}
                onClick={() => setV({ ...v, durationMinutes: String(d) })}
              >
                {d}
              </button>
            ))}
          </div>
          {error("durationMinutes")}
        </div>
        {!oneOff && (
          <fieldset className="flex flex-wrap items-end gap-3 sm:col-span-3">
            <legend className="mb-1 text-sm font-medium">
              Période <span className="font-normal text-doux">(facultatif : vide, toute la saison)</span>
            </legend>
            <div className="flex flex-col gap-1">
              {label("date-debut", "Du")}
              <input
                id="date-debut"
                type="date"
                className="champ"
                value={v.startDate}
                onChange={updated("startDate")}
              />
            </div>
            <div className="flex flex-col gap-1">
              {label("date-fin", "Au")}
              <input
                id="date-fin"
                type="date"
                className="champ"
                value={v.endDate}
                onChange={updated("endDate")}
                {...invalid("endDate")}
              />
            </div>
            {error("endDate")}
          </fieldset>
        )}
      </fieldset>

      <fieldset className="panneau p-4 grid gap-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Lieu</legend>
        <div className="flex flex-col gap-1 sm:col-span-2">
          {label("salle", "Salle")}
          <select id="salle" className="champ" value={v.roomId} onChange={updated("roomId")}>
            {r.salles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}, {s.site}
                {s.capacity ? ` (${s.capacity} places)` : ""}
              </option>
            ))}
            <option value={NEW}>Nouvelle salle…</option>
          </select>
          {error("room")}
        </div>
        {v.roomId === NEW && (
          <>
            <div className="flex flex-col gap-1">
              {label("nouvelle-salle", "Nom de la salle")}
              <input
                id="nouvelle-salle"
                className="champ"
                autoComplete="off"
                value={v.newRoom}
                onChange={updated("newRoom")}
              />
            </div>
            <div className="flex flex-col gap-1">
              {label("capacite-salle", "Capacité de la salle (facultatif)")}
              <input
                id="capacite-salle"
                type="number"
                min={1}
                className="champ"
                value={v.roomCapacity}
                onChange={updated("roomCapacity")}
              />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              {label("site", "Site")}
              <select id="site" className="champ" value={v.siteId} onChange={updated("siteId")}>
                {r.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value={NEW}>Nouveau site…</option>
              </select>
            </div>
            {v.siteId === NEW && (
              <>
                <div className="flex flex-col gap-1">
                  {label("nouveau-site", "Nom du site")}
                  <input
                    id="nouveau-site"
                    className="champ"
                    autoComplete="off"
                    value={v.newSite}
                    onChange={updated("newSite")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  {label("adresse-site", "Adresse du site")}
                  <input
                    id="adresse-site"
                    className="champ"
                    autoComplete="off"
                    value={v.siteAddress}
                    onChange={updated("siteAddress")}
                  />
                </div>
              </>
            )}
          </>
        )}
      </fieldset>

      <fieldset className="panneau p-4 grid gap-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">Public</legend>
        <div className="flex flex-col gap-1">
          {label("age-min", "Âge minimum")}
          <input id="age-min" type="number" min={0} className="champ" value={v.ageMin} onChange={updated("ageMin")} />
        </div>
        <div className="flex flex-col gap-1">
          {label("age-max", "Âge maximum")}
          <input
            id="age-max"
            type="number"
            min={0}
            className="champ"
            value={v.ageMax}
            onChange={updated("ageMax")}
            {...invalid("ageMax")}
          />
          {error("ageMax")}
        </div>
        <div className="flex flex-col gap-1">
          {label("capacite", "Places")}
          <input
            id="capacite"
            type="number"
            min={1}
            className="champ"
            placeholder={chosenRoom?.capacity ? `${chosenRoom.capacity} (salle)` : "sans limite"}
            value={v.maxCapacity}
            onChange={updated("maxCapacity")}
          />
        </div>
      </fieldset>

      {displayedUnavailability.length > 0 && (
        <div role="status" className="rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">
          <p className="font-medium">
            {chosenInstructor?.firstName} est indisponible{" "}
            {displayedUnavailability.length > 1 ? `${displayedUnavailability.length} fois` : "une fois"} sur ce créneau
            :
          </p>
          <p>
            {displayedUnavailability
              .slice(0, 6)
              .map((d) => shortDate.format(new Date(`${d}T00:00:00Z`)))
              .join(", ")}
            {displayedUnavailability.length > 6 && "…"}
          </p>
        </div>
      )}

      {outsideOpening && (
        <p role="status" className="rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">
          {outsideOpening} Le cours reste possible.
        </p>
      )}

      {overlaps.length > 0 && (
        <div role="status" className="rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">
          <p className="font-medium">Ce créneau est déjà occupé :</p>
          <ul className="list-disc pl-5">
            {overlaps.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {refusal && (
        <p tabIndex={-1} role="alert" className="text-sm text-erreur">
          {refusal.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-bordure pt-4">
        <button type="submit" className="bouton-principal" disabled={sending}>
          {sending ? "Enregistrement…" : cours ? "Enregistrer les modifications" : "Créer le cours"}
        </button>
        <Cancel href={cours ? `/planning/cours/${cours.id}` : "/planning"} />
        {cours &&
          (confirmDeletion ? (
            <span className="ml-auto flex items-center gap-2 text-sm">
              Supprimer ce cours ?
              <button
                type="button"
                className="rounded-md border border-erreur px-3 py-1.5 text-sm font-medium text-erreur hover:bg-erreur/10 disabled:opacity-50"
                disabled={sending}
                onClick={() =>
                  startTransition(async () => {
                    setRefusal(await remove(cours.id));
                    setConfirm(false);
                  })
                }
              >
                Oui, supprimer
              </button>
              <button type="button" className="bouton-secondaire" onClick={() => setConfirm(false)}>
                Non
              </button>
            </span>
          ) : (
            <button type="button" className="lien ml-auto text-sm text-erreur" onClick={() => setConfirm(true)}>
              Supprimer le cours
            </button>
          ))}
      </div>
    </form>
  );
}
