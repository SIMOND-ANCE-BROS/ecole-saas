"use client";

import { useState, useTransition } from "react";
import { MOYENS } from "@/db/paiements";
import type { LigneJournal } from "@/db/remises";
import type { MoyenRemise } from "@/domaine/encaissement/remises";
import { formaterEuros } from "@/lib/montant";
import { remettre } from "./actions";

const jour = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Paiements d'un moyen à remettre (#98) : tous cochés par défaut ; la remise
 * prend la date choisie (aujourd'hui par défaut) et ouvre son bordereau.
 */
export function ARemettre({ moyen, paiements, aujourdhui }: { moyen: MoyenRemise; paiements: LigneJournal[]; aujourdhui: string }) {
  const [choisis, setChoisis] = useState(() => new Set(paiements.map((p) => p.id)));
  const [date, setDate] = useState(aujourdhui);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, demarrer] = useTransition();
  const selection = paiements.filter((p) => choisis.has(p.id));
  const total = selection.reduce((s, p) => s + p.montantCentimes, 0);
  const basculer = (id: string) => {
    const s = new Set(choisis);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setChoisis(s);
  };
  const titre = MOYENS[moyen];

  return (
    <section aria-labelledby={`remettre-${moyen}`} className="flex flex-col gap-2">
      <h2 id={`remettre-${moyen}`} className="text-base font-semibold">
        {titre} <span className="text-sm font-normal text-doux">— {paiements.length} à remettre</span>
      </h2>
      <div className="panneau overflow-x-auto">
        <table className="tableau">
          <caption className="sr-only">{titre} à remettre</caption>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label={`Tout sélectionner (${titre.toLowerCase()})`}
                  checked={choisis.size === paiements.length}
                  onChange={(e) => setChoisis(new Set(e.target.checked ? paiements.map((p) => p.id) : []))}
                />
              </th>
              <th>Payeur</th>
              {moyen !== "especes" && <th>N°</th>}
              {moyen === "cheque" && <th>Banque ou titulaire</th>}
              <th>Reçu le</th>
              {moyen === "cheque" && <th>À encaisser le</th>}
              <th className="text-right">Montant</th>
            </tr>
          </thead>
          <tbody>
            {paiements.map((p) => (
              <tr key={p.id}>
                <td>
                  <input type="checkbox" aria-label={`Remettre le paiement de ${p.payeur}, ${formaterEuros(p.montantCentimes)}`} checked={choisis.has(p.id)} onChange={() => basculer(p.id)} />
                </td>
                <td>{p.payeur}</td>
                {moyen !== "especes" && <td>{p.reference ?? "—"}</td>}
                {moyen === "cheque" && <td>{p.emetteur ?? "—"}</td>}
                <td className="whitespace-nowrap">{jour(p.date)}</td>
                {moyen === "cheque" && <td className="whitespace-nowrap">{p.encaissementPrevu ? jour(p.encaissementPrevu) : "—"}</td>}
                <td className="text-right tabular-nums whitespace-nowrap">
                  {formaterEuros(p.montantCentimes)}
                  {p.corrigeCentimes > 0 && <span className="block text-xs text-alerte-texte">dont {formaterEuros(p.corrigeCentimes)} corrigés</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage(null);
          demarrer(async () => setMessage((await remettre({ date, moyen, paiementIds: selection.map((p) => p.id) })).message));
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`date-remise-${moyen}`} className="text-xs text-doux">
            Date de la remise
          </label>
          <input id={`date-remise-${moyen}`} type="date" className="champ" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <button type="submit" className="bouton-principal" disabled={envoi || selection.length === 0}>
          {envoi ? "Création…" : `Créer la remise : ${selection.length} × ${titre.toLowerCase()}, ${formaterEuros(total)}`}
        </button>
        {message && (
          <p role="alert" className="text-sm text-erreur">
            {message}
          </p>
        )}
      </form>
    </section>
  );
}
