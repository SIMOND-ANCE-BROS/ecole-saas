"use client";

import { useState, useTransition } from "react";
import type { Closure } from "@/db/lessons";
import { close, updateLessons, reopen } from "../seances/actions";

const shortDate = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const day = (iso: string) => shortDate.format(new Date(`${iso}T00:00:00Z`));

type Props = { closures: Closure[]; seasonStart: string; seasonEnd: string };

export function ClosuresManagement({ closures: closures, seasonStart: seasonStart, seasonEnd: seasonEnd }: Props) {
  const [v, setV] = useState({ label: "", start: "", end: "" });
  const [message, setMessage] = useState<{ texte: string; error: boolean } | null>(null);
  const [inProgress, startTransition] = useTransition();

  const act = (action: () => Promise<{ message: string | null }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const { message: error } = await action();
      setMessage(error ? { texte: error, error: true } : { texte: success, error: false });
      if (!error) after?.();
    });

  return (
    <div className="flex flex-col gap-5">
      <form
        className="panneau grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto] lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          act(
            () => close({ ...v, end: v.end || v.start }),
            "Fermeture ajoutée, séances mises à jour.",
            () => setV({ label: "", start: "", end: "" }),
          );
        }}
      >
        <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
          <label htmlFor="libelle" className="text-sm font-medium">
            Libellé
          </label>
          <input
            id="libelle"
            className="champ"
            placeholder="Vacances de la Toussaint"
            autoFocus
            value={v.label}
            onChange={(e) => setV({ ...v, label: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="debut" className="text-sm font-medium">
            Du
          </label>
          <input
            id="debut"
            type="date"
            className="champ"
            min={seasonStart}
            max={seasonEnd}
            value={v.start}
            onChange={(e) => setV({ ...v, start: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="fin" className="text-sm font-medium">
            Au (inclus)
          </label>
          <input
            id="fin"
            type="date"
            className="champ"
            min={v.start || seasonStart}
            max={seasonEnd}
            value={v.end}
            onChange={(e) => setV({ ...v, end: e.target.value })}
          />
        </div>
        <button
          type="submit"
          className="bouton-principal sm:col-span-2 sm:justify-self-start lg:col-span-1"
          disabled={inProgress}
        >
          Ajouter
        </button>
      </form>

      {message && (
        <p role={message.error ? "alert" : "status"} className={`text-sm ${message.error ? "text-erreur" : ""}`}>
          {message.texte}
        </p>
      )}

      {closures.length === 0 ? (
        <p className="text-sm text-doux">
          Aucune fermeture pour cette saison. Pensez aux vacances scolaires de votre zone et aux jours fériés.
        </p>
      ) : (
        <ul className="panneau divide-y divide-bordure text-sm">
          {closures.map((f) => (
            <li key={f.id} className="flex flex-wrap items-baseline gap-x-4 px-3 py-2">
              <span className="font-medium">{f.label}</span>
              <span className="tabular-nums text-doux">
                {f.start === f.end ? day(f.start) : `${day(f.start)} au ${day(f.end)}`}
              </span>
              <button
                type="button"
                className="lien ml-auto text-xs text-doux"
                disabled={inProgress}
                onClick={() => act(() => reopen(f.id), "Fermeture retirée, séances remises.")}
                aria-label={`Retirer la fermeture ${f.label}`}
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3 border-t border-bordure pt-4 text-sm">
        <button
          type="button"
          className="bouton-secondaire"
          disabled={inProgress}
          onClick={() => act(updateLessons, "Séances à venir mises à jour.")}
        >
          Mettre à jour les séances
        </button>
        <span className="text-doux">À utiliser une fois en début de saison, ou après une reprise de données.</span>
      </div>
    </div>
  );
}
