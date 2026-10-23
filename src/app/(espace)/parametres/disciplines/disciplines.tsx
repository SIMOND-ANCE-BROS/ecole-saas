"use client";

import { useState, useTransition } from "react";
import type { DisciplineRow } from "@/db/settings";
import { newDiscipline, rename, removeDiscipline } from "../actions";

export function Disciplines({ disciplines }: { disciplines: DisciplineRow[] }) {
  const [name, setName] = useState("");
  const [edition, setEdition] = useState<{ id: string; name: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();
  const act = (action: () => Promise<{ message: string | null }>, after?: () => void) =>
    startTransition(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) after?.();
    });

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          act(
            () => newDiscipline(name),
            () => setName(""),
          );
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="nouvelle-discipline" className="text-sm font-medium">
            Nouvelle discipline
          </label>
          <input
            id="nouvelle-discipline"
            className="champ"
            placeholder="Hip-hop"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button type="submit" className="bouton-principal" disabled={inProgress || !name.trim()}>
          Ajouter
        </button>
      </form>
      {message && (
        <p role="alert" className="text-sm text-erreur">
          {message}
        </p>
      )}
      {disciplines.length === 0 ? (
        <p className="text-sm text-doux">Aucune discipline pour l’instant.</p>
      ) : (
        <ul className="panneau divide-y divide-bordure text-sm">
          {disciplines.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              {edition?.id === d.id ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(
                      () => rename(d.id, edition.name),
                      () => setEdition(null),
                    );
                  }}
                >
                  <label className="sr-only" htmlFor={`nom-${d.id}`}>
                    Nom
                  </label>
                  <input
                    id={`nom-${d.id}`}
                    className="champ"
                    autoFocus
                    value={edition.name}
                    onChange={(e) => setEdition({ ...edition, name: e.target.value })}
                  />
                  <button type="submit" className="lien" disabled={inProgress}>
                    Enregistrer
                  </button>
                  <button type="button" className="lien text-doux" onClick={() => setEdition(null)}>
                    Annuler
                  </button>
                </form>
              ) : (
                <span className="font-medium">{d.name}</span>
              )}
              <span className="text-doux">
                {d.course} cours
                {d.tariffs > 0 && `, ${d.tariffs} tarif${d.tariffs > 1 ? "s" : ""} dédié${d.tariffs > 1 ? "s" : ""}`}
              </span>
              {edition?.id !== d.id && (
                <span className="ml-auto flex gap-3">
                  <button type="button" className="lien" onClick={() => setEdition({ id: d.id, name: d.name })}>
                    Renommer
                  </button>
                  {d.course === 0 && d.tariffs === 0 && (
                    <button
                      type="button"
                      className="lien text-doux"
                      disabled={inProgress}
                      onClick={() => act(() => removeDiscipline(d.id))}
                    >
                      Retirer
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
