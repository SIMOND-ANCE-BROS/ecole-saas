"use client";

import { useState, useTransition } from "react";
import { addUnavailabilityAction, removeUnavailability } from "../actions";

export type DisplayedUnavailability = {
  id: string;
  start: string;
  end: string;
  source: "manual" | "google" | "microsoft";
  label: string | null;
};

const SOURCE = { manual: null, google: "Google Agenda", microsoft: "Microsoft" } as const;
const day = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Europe/Paris",
});
const heure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

/** « mer. 4 nov., 16:30 à 19:00 », or « mer. 4 nov. au ven. 6 nov. » for whole days. */
function range(isoStart: string, isoEnd: string): string {
  const start = new Date(isoStart);
  const end = new Date(isoEnd);
  const midnight = (d: Date) => heure.format(d) === "00:00";
  if (midnight(start) && midnight(end)) {
    const last = new Date(end.getTime() - 1);
    return day.format(start) === day.format(last)
      ? `${day.format(start)}, journée`
      : `${day.format(start)} au ${day.format(last)}`;
  }
  return day.format(start) === day.format(end)
    ? `${day.format(start)}, ${heure.format(start)} à ${heure.format(end)}`
    : `${day.format(start)} ${heure.format(start)} au ${day.format(end)} ${heure.format(end)}`;
}

/** Upcoming unavailabilities of an instructor; those from a connected calendar cannot be removed here. */
export function Unavailabilities({
  instructorId: instructorId,
  firstName: firstName,
  unavailabilities: unavailabilities,
}: {
  instructorId: string;
  firstName: string;
  unavailabilities: DisplayedUnavailability[];
}) {
  const [v, setV] = useState({ du: "", au: "", de: "", a: "", label: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const updated = (field: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [field]: e.target.value });

  return (
    <section aria-labelledby="indisponibilites" className="panneau flex min-w-0 flex-col gap-3 p-4 text-sm">
      <div>
        <h2 id="indisponibilites" className="text-base font-semibold">
          Indisponibilités de {firstName}
        </h2>
        <p className="text-doux">
          Elles signalent les séances en conflit et écartent {firstName} des remplaçants proposés.
        </p>
      </div>

      {unavailabilities.length === 0 ? (
        <p className="text-doux">Aucune indisponibilité à venir.</p>
      ) : (
        <ul className="divide-y divide-bordure rounded-md border border-bordure">
          {unavailabilities.map((i) => (
            <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
              <span className="tabular-nums">{range(i.start, i.end)}</span>
              {i.label && <span className="text-doux">{i.label}</span>}
              {SOURCE[i.source] ? (
                <span className="ml-auto text-xs text-doux">{SOURCE[i.source]}</span>
              ) : (
                <button
                  type="button"
                  className="lien ml-auto text-xs text-doux"
                  disabled={inProgress}
                  onClick={() =>
                    startTransition(async () => setMessage((await removeUnavailability(instructorId, i.id)).message))
                  }
                >
                  Retirer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid gap-2 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const { message: error } = await addUnavailabilityAction(instructorId, { ...v, au: v.au || v.du });
            setMessage(error);
            if (!error) setV({ du: "", au: "", de: "", a: "", label: "" });
          });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="indispo-du" className="font-medium">
            Du
          </label>
          <input id="indispo-du" type="date" className="champ" required value={v.du} onChange={updated("du")} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="indispo-au" className="font-medium">
            Au (inclus)
          </label>
          <input id="indispo-au" type="date" className="champ" min={v.du} value={v.au} onChange={updated("au")} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="indispo-de" className="font-medium">
            De (facultatif)
          </label>
          <input id="indispo-de" type="time" className="champ" value={v.de} onChange={updated("de")} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="indispo-a" className="font-medium">
            À
          </label>
          <input id="indispo-a" type="time" className="champ" value={v.a} onChange={updated("a")} />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-3">
          <label htmlFor="indispo-libelle" className="font-medium">
            Motif (facultatif)
          </label>
          <input
            id="indispo-libelle"
            className="champ"
            placeholder="Stage, congé, rendez-vous…"
            value={v.label}
            onChange={updated("label")}
          />
        </div>
        <button type="submit" className="bouton-secondaire self-end" disabled={inProgress}>
          Ajouter
        </button>
      </form>
      <p className="text-xs text-doux">Sans heures : journées entières. Heures de Paris.</p>
      {message && (
        <p role="alert" className="text-erreur">
          {message}
        </p>
      )}
    </section>
  );
}
