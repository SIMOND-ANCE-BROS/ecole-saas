"use client";

import { Button, Checkbox, Text } from "@mantine/core";
import { TimeInput } from "@mantine/dates";
import { useState, useTransition } from "react";
import type { Hours } from "@/domain/schedule/hours";
import { changeHours } from "../actions";
import { settle } from "../../_ui/settle";

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
            const r = await settle(() => changeHours(siteId, entry));
            setMessage(r.ok ? { ok: true, text: "Horaires enregistrés." } : { ok: false, text: r.message });
          });
        }}
      >
        <table className="text-sm">
          <caption className="sr-only">Horaires d’ouverture de {name}</caption>
          <tbody>
            {[1, 2, 3, 4, 5, 6, 7].map((j) => (
              <tr key={j}>
                <td className="py-1 pr-3">
                  <Checkbox
                    label={DAYS[j]}
                    checked={days[j].open}
                    onChange={(e) => updated(j, { open: e.currentTarget.checked })}
                  />
                </td>
                <td className="py-1">
                  {days[j].open ? (
                    <span className="flex items-center gap-2">
                      <TimeInput
                        aria-label={`Ouverture le ${DAYS[j].toLowerCase()}`}
                        step={900}
                        value={days[j].opening}
                        onChange={(e) => updated(j, { opening: e.currentTarget.value })}
                      />
                      <span aria-hidden>–</span>
                      <TimeInput
                        aria-label={`Fermeture le ${DAYS[j].toLowerCase()}`}
                        step={900}
                        value={days[j].closure}
                        onChange={(e) => updated(j, { closure: e.currentTarget.value })}
                      />
                    </span>
                  ) : (
                    <Text span size="sm" c="dimmed">
                      fermé
                    </Text>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="default" loading={inProgress}>
            Enregistrer les horaires
          </Button>
          {open > 1 && (
            <Button
              size="compact-sm"
              variant="subtle"
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
            </Button>
          )}
          <Text span role="status" size="sm" c={message?.ok === false ? "red" : "dimmed"}>
            {message?.text}
          </Text>
        </div>
      </form>
    </details>
  );
}
