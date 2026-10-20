"use client";

import { useState, useTransition } from "react";
import type { LigneSaison } from "@/db/parametres";
import { changerSaison, nouvelleSaison } from "../actions";

const date = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const jour = (iso: string) => date.format(new Date(`${iso}T00:00:00Z`));

/** Proposition pour la saison suivante : un an après la plus récente. */
function suivante(saisons: LigneSaison[]) {
  const derniere = saisons[0];
  if (!derniere) return { libelle: "", dateDebut: "", dateFin: "" };
  const plusUnAn = (iso: string) => `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
  const [a, b] = derniere.libelle.split("-").map(Number);
  return {
    libelle: Number.isInteger(a) && Number.isInteger(b) ? `${a + 1}-${b + 1}` : "",
    dateDebut: plusUnAn(derniere.dateDebut),
    dateFin: plusUnAn(derniere.dateFin),
  };
}

export function Saisons({ saisons }: { saisons: LigneSaison[] }) {
  const [v, setV] = useState(suivante(saisons));
  const [reprendre, setReprendre] = useState(saisons[0]?.id ?? "");
  const [edition, setEdition] = useState<{ id: string; libelle: string; dateDebut: string; dateFin: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const agir = (action: () => Promise<{ message: string | null }>, apres?: () => void) =>
    demarrer(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) apres?.();
    });

  return (
    <div className="flex flex-col gap-5">
      {saisons.length > 0 && (
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
              {saisons.map((s) =>
                edition?.id === s.id ? (
                  <tr key={s.id}>
                    <td>
                      <label className="sr-only" htmlFor="edition-libelle">
                        Libellé
                      </label>
                      <input id="edition-libelle" className="champ w-32" value={edition.libelle} onChange={(e) => setEdition({ ...edition, libelle: e.target.value })} />
                    </td>
                    <td>
                      <label className="sr-only" htmlFor="edition-debut">
                        Début
                      </label>
                      <input id="edition-debut" type="date" className="champ" value={edition.dateDebut} onChange={(e) => setEdition({ ...edition, dateDebut: e.target.value })} />
                    </td>
                    <td>
                      <label className="sr-only" htmlFor="edition-fin">
                        Fin
                      </label>
                      <input id="edition-fin" type="date" className="champ" value={edition.dateFin} onChange={(e) => setEdition({ ...edition, dateFin: e.target.value })} />
                    </td>
                    <td className="text-right tabular-nums">{s.cours}</td>
                    <td className="text-right tabular-nums">{s.tarifs}</td>
                    <td className="whitespace-nowrap">
                      <button
                        type="button"
                        className="lien text-sm"
                        disabled={enCours}
                        onClick={() => agir(() => changerSaison(s.id, { libelle: edition.libelle, dateDebut: edition.dateDebut, dateFin: edition.dateFin }), () => setEdition(null))}
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
                    <td className="font-medium">{s.libelle}</td>
                    <td className="tabular-nums">{jour(s.dateDebut)}</td>
                    <td className="tabular-nums">{jour(s.dateFin)}</td>
                    <td className="text-right tabular-nums">{s.cours}</td>
                    <td className="text-right tabular-nums">{s.tarifs}</td>
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
          agir(() => nouvelleSaison(v, reprendre || null), () => setV({ libelle: "", dateDebut: "", dateFin: "" }));
        }}
      >
        <p className="text-sm font-semibold sm:col-span-2 lg:col-span-4">Nouvelle saison</p>
        <div className="flex flex-col gap-1">
          <label htmlFor="libelle" className="text-sm font-medium">
            Libellé
          </label>
          <input id="libelle" className="champ" placeholder="2027-2028" value={v.libelle} onChange={(e) => setV({ ...v, libelle: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="debut" className="text-sm font-medium">
            Du
          </label>
          <input id="debut" type="date" className="champ" value={v.dateDebut} onChange={(e) => setV({ ...v, dateDebut: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="fin" className="text-sm font-medium">
            Au
          </label>
          <input id="fin" type="date" className="champ" value={v.dateFin} onChange={(e) => setV({ ...v, dateFin: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="reprendre" className="text-sm font-medium">
            Reprendre la grille de
          </label>
          <select id="reprendre" className="champ" value={reprendre} onChange={(e) => setReprendre(e.target.value)}>
            <option value="">Aucune (grille vide)</option>
            {saisons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.libelle}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="bouton-principal sm:col-span-2 sm:justify-self-start lg:col-span-4" disabled={enCours}>
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
