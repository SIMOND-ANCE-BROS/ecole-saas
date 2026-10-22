"use client";

import { useState, useTransition } from "react";
import type { LigneDiscipline } from "@/db/parametres";
import { nouvelleDiscipline, renommer, retirerDiscipline } from "../actions";

export function Disciplines({ disciplines }: { disciplines: LigneDiscipline[] }) {
  const [nom, setNom] = useState("");
  const [edition, setEdition] = useState<{ id: string; nom: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const agir = (action: () => Promise<{ message: string | null }>, apres?: () => void) =>
    demarrer(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) apres?.();
    });

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          agir(
            () => nouvelleDiscipline(nom),
            () => setNom(""),
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
            value={nom}
            onChange={(e) => setNom(e.target.value)}
          />
        </div>
        <button type="submit" className="bouton-principal" disabled={enCours || !nom.trim()}>
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
                    agir(
                      () => renommer(d.id, edition.nom),
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
                    value={edition.nom}
                    onChange={(e) => setEdition({ ...edition, nom: e.target.value })}
                  />
                  <button type="submit" className="lien" disabled={enCours}>
                    Enregistrer
                  </button>
                  <button type="button" className="lien text-doux" onClick={() => setEdition(null)}>
                    Annuler
                  </button>
                </form>
              ) : (
                <span className="font-medium">{d.nom}</span>
              )}
              <span className="text-doux">
                {d.cours} cours
                {d.tarifs > 0 && `, ${d.tarifs} tarif${d.tarifs > 1 ? "s" : ""} dédié${d.tarifs > 1 ? "s" : ""}`}
              </span>
              {edition?.id !== d.id && (
                <span className="ml-auto flex gap-3">
                  <button type="button" className="lien" onClick={() => setEdition({ id: d.id, nom: d.nom })}>
                    Renommer
                  </button>
                  {d.cours === 0 && d.tarifs === 0 && (
                    <button
                      type="button"
                      className="lien text-doux"
                      disabled={enCours}
                      onClick={() => agir(() => retirerDiscipline(d.id))}
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
