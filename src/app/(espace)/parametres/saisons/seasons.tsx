"use client";

import { useState, useTransition } from "react";
import type { SeasonRow } from "@/db/settings";
import { changeSeason, newSeason } from "../actions";

const date = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const day = (iso: string) => date.format(new Date(`${iso}T00:00:00Z`));

/** Suggestion for the next season: one year after the most recent one. */
function next(seasons: SeasonRow[]) {
  const last = seasons[0];
  if (!last) return { label: "", startDate: "", endDate: "" };
  const plusUnAn = (iso: string) => `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
  const [a, b] = last.label.split("-").map(Number);
  return {
    label: Number.isInteger(a) && Number.isInteger(b) ? `${a + 1}-${b + 1}` : "",
    startDate: plusUnAn(last.startDate),
    endDate: plusUnAn(last.endDate),
  };
}

export function Seasons({ seasons: seasons }: { seasons: SeasonRow[] }) {
  const [v, setV] = useState(next(seasons));
  const [copy, setCopy] = useState(seasons[0]?.id ?? "");
  const [edition, setEdition] = useState<{ id: string; label: string; startDate: string; endDate: string } | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const act = (action: () => Promise<{ message: string | null }>, after?: () => void) =>
    startTransition(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) after?.();
    });

  return (
    <div className="flex flex-col gap-5">
      {seasons.length > 0 && (
        <div className="panneau overflow-x-auto">
          <table className="tableau">
            <thead>
              <tr>
                <th>Saison</th>
                <th>Du</th>
                <th>Au</th>
                <th className="text-right">Cours</th>
                <th className="text-right">Tarifs</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s) =>
                edition?.id === s.id ? (
                  <tr key={s.id}>
                    <td>
                      <label className="sr-only" htmlFor="edition-libelle">
                        Libellé
                      </label>
                      <input
                        id="edition-libelle"
                        className="champ w-32"
                        value={edition.label}
                        onChange={(e) => setEdition({ ...edition, label: e.target.value })}
                      />
                    </td>
                    <td>
                      <label className="sr-only" htmlFor="edition-debut">
                        Début
                      </label>
                      <input
                        id="edition-debut"
                        type="date"
                        className="champ"
                        value={edition.startDate}
                        onChange={(e) => setEdition({ ...edition, startDate: e.target.value })}
                      />
                    </td>
                    <td>
                      <label className="sr-only" htmlFor="edition-fin">
                        Fin
                      </label>
                      <input
                        id="edition-fin"
                        type="date"
                        className="champ"
                        value={edition.endDate}
                        onChange={(e) => setEdition({ ...edition, endDate: e.target.value })}
                      />
                    </td>
                    <td className="text-right tabular-nums">{s.course}</td>
                    <td className="text-right tabular-nums">{s.tariffs}</td>
                    <td className="whitespace-nowrap">
                      <button
                        type="button"
                        className="lien text-sm"
                        disabled={inProgress}
                        onClick={() =>
                          act(
                            () =>
                              changeSeason(s.id, {
                                label: edition.label,
                                startDate: edition.startDate,
                                endDate: edition.endDate,
                              }),
                            () => setEdition(null),
                          )
                        }
                      >
                        Enregistrer
                      </button>{" "}
                      <button type="button" className="lien text-sm text-doux" onClick={() => setEdition(null)}>
                        Annuler
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id}>
                    <td className="font-medium">{s.label}</td>
                    <td className="tabular-nums">{day(s.startDate)}</td>
                    <td className="tabular-nums">{day(s.endDate)}</td>
                    <td className="text-right tabular-nums">{s.course}</td>
                    <td className="text-right tabular-nums">{s.tariffs}</td>
                    <td>
                      <button type="button" className="lien text-sm" onClick={() => setEdition(s)}>
                        Modifier
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      <form
        className="panneau grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          act(
            () => newSeason(v, copy || null),
            () => setV({ label: "", startDate: "", endDate: "" }),
          );
        }}
      >
        <p className="text-sm font-semibold sm:col-span-2 lg:col-span-4">Nouvelle saison</p>
        <div className="flex flex-col gap-1">
          <label htmlFor="libelle" className="text-sm font-medium">
            Libellé
          </label>
          <input
            id="libelle"
            className="champ"
            placeholder="2027-2028"
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
            value={v.startDate}
            onChange={(e) => setV({ ...v, startDate: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="fin" className="text-sm font-medium">
            Au
          </label>
          <input
            id="fin"
            type="date"
            className="champ"
            value={v.endDate}
            onChange={(e) => setV({ ...v, endDate: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="reprendre" className="text-sm font-medium">
            Reprendre la grille de
          </label>
          <select id="reprendre" className="champ" value={copy} onChange={(e) => setCopy(e.target.value)}>
            <option value="">Aucune (grille vide)</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="bouton-principal sm:col-span-2 sm:justify-self-start lg:col-span-4"
          disabled={inProgress}
        >
          Créer la saison
        </button>
      </form>
      {message && (
        <p role="alert" className="text-sm text-erreur">
          {message}
        </p>
      )}
    </div>
  );
}
