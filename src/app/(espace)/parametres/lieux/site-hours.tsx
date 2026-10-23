"use client";

import { useState, useTransition } from "react";
import type { Hours } from "@/domain/schedule/hours";
import { changeHours } from "../actions";

const DAYS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
type Day = { open: boolean; opening: string; closure: string };

/**
 * Opening days and hours of a site (#90): the schedule calendar is bounded by
 * them and the course form warns about a slot outside them. With no day
 * ticked, the site imposes nothing.
 */
export function SiteHours({ siteId, name: name, hours: hours }: { siteId: string; name: string; hours: Hours[] }) {
  const initial = () =>
    Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7].map((j) => {
        const h = hours.find((x) => x.weekday === j);
        return [j, { open: !!h, opening: h?.opening ?? "09:00", closure: h?.closure ?? "22:00" }];
      }),
    ) as Record<number, Day>;
  const [days, setDays] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [inProgress, startTransition] = useTransition();
  const updated = (j: number, v: Partial<Day>) => setDays({ ...days, [j]: { ...days[j], ...v } });
  const open = Object.values(days).filter((j) => j.open).length;

  return (
    <details className="rounded-md border border-bordure" open={hours.length > 0 || undefined}>
      <summary className="cursor-pointer px-3 py-2 font-medium">
        Horaires d’ouverture{" "}
        <span className="font-normal text-doux">
          {hours.length === 0
            ? "— non renseignés (le planning reste libre)"
            : `— ${hours.length} jour${hours.length > 1 ? "s" : ""}`}
        </span>
      </summary>
      <form
        className="flex flex-col gap-2 px-3 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          const entry = [1, 2, 3, 4, 5, 6, 7]
            .filter((j) => days[j].open)
            .map((j) => ({ weekday: j, opening: days[j].opening, closure: days[j].closure }));
          startTransition(async () => {
            const r = await changeHours(siteId, entry);
            setMessage(r.message ? { ok: false, text: r.message } : { ok: true, text: "Horaires enregistrés." });
          });
        }}
      >
        <table className="text-sm">
          <caption className="sr-only">Horaires d’ouverture de {name}</caption>
          <tbody>
            {[1, 2, 3, 4, 5, 6, 7].map((j) => (
              <tr key={j}>
                <td className="py-1 pr-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={days[j].open}
                      onChange={(e) => updated(j, { open: e.target.checked })}
                    />
                    {DAYS[j]}
                  </label>
                </td>
                <td className="py-1">
                  {days[j].open ? (
                    <span className="flex items-center gap-2">
                      <label className="sr-only" htmlFor={`ouv-${siteId}-${j}`}>
                        Ouverture le {DAYS[j].toLowerCase()}
                      </label>
                      <input
                        id={`ouv-${siteId}-${j}`}
                        type="time"
                        step={900}
                        className="champ"
                        value={days[j].opening}
                        onChange={(e) => updated(j, { opening: e.target.value })}
                      />
                      <span aria-hidden>–</span>
                      <label className="sr-only" htmlFor={`ferm-${siteId}-${j}`}>
                        Fermeture le {DAYS[j].toLowerCase()}
                      </label>
                      <input
                        id={`ferm-${siteId}-${j}`}
                        type="time"
                        step={900}
                        className="champ"
                        value={days[j].closure}
                        onChange={(e) => updated(j, { closure: e.target.value })}
                      />
                    </span>
                  ) : (
                    <span className="text-doux">fermé</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="bouton-secondaire" disabled={inProgress}>
            {inProgress ? "Enregistrement…" : "Enregistrer les horaires"}
          </button>
          {open > 1 && (
            <button
              type="button"
              className="lien text-sm"
              onClick={() => {
                const first = [1, 2, 3, 4, 5, 6, 7].find((j) => days[j].open)!;
                const { opening: opening, closure: closure } = days[first];
                setDays(
                  Object.fromEntries(
                    Object.entries(days).map(([k, v]) => [
                      k,
                      v.open ? { ...v, opening: opening, closure: closure } : v,
                    ]),
                  ) as Record<number, Day>,
                );
              }}
            >
              Mêmes heures pour tous les jours ouverts
            </button>
          )}
          <span role="status" className={`text-sm ${message?.ok === false ? "text-erreur" : "text-doux"}`}>
            {message?.text}
          </span>
        </div>
      </form>
    </details>
  );
}
