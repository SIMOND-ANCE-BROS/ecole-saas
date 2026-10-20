"use client";

import { useState, useTransition } from "react";
import type { Horaire } from "@/domaine/planning/horaires";
import { changerHoraires } from "../actions";

const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
type Jour = { ouvert: boolean; ouverture: string; fermeture: string };

/**
 * Jours et heures d'ouverture d'un site (#90) : l'agenda du planning s'y
 * limite et le formulaire de cours prévient d'un créneau qui en sort. Sans
 * aucun jour coché, le site n'impose rien.
 */
export function HorairesSite({ siteId, nom, horaires }: { siteId: string; nom: string; horaires: Horaire[] }) {
  const initial = () =>
    Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7].map((j) => {
        const h = horaires.find((x) => x.jourSemaine === j);
        return [j, { ouvert: !!h, ouverture: h?.ouverture ?? "09:00", fermeture: h?.fermeture ?? "22:00" }];
      }),
    ) as Record<number, Jour>;
  const [jours, setJours] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();
  const maj = (j: number, v: Partial<Jour>) => setJours({ ...jours, [j]: { ...jours[j], ...v } });
  const ouverts = Object.values(jours).filter((j) => j.ouvert).length;

  return (
    <details className="rounded-md border border-bordure" open={horaires.length > 0 || undefined}>
      <summary className="cursor-pointer px-3 py-2 font-medium">
        Horaires d’ouverture{" "}
        <span className="font-normal text-doux">
          {horaires.length === 0 ? "— non renseignés (le planning reste libre)" : `— ${horaires.length} jour${horaires.length > 1 ? "s" : ""}`}
        </span>
      </summary>
      <form
        className="flex flex-col gap-2 px-3 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          const saisie = [1, 2, 3, 4, 5, 6, 7].filter((j) => jours[j].ouvert).map((j) => ({ jourSemaine: j, ouverture: jours[j].ouverture, fermeture: jours[j].fermeture }));
          demarrer(async () => {
            const r = await changerHoraires(siteId, saisie);
            setMessage(r.message ? { ok: false, texte: r.message } : { ok: true, texte: "Horaires enregistrés." });
          });
        }}
      >
        <table className="text-sm">
          <caption className="sr-only">Horaires d’ouverture de {nom}</caption>
          <tbody>
            {[1, 2, 3, 4, 5, 6, 7].map((j) => (
              <tr key={j}>
                <td className="py-1 pr-3">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={jours[j].ouvert} onChange={(e) => maj(j, { ouvert: e.target.checked })} />
                    {JOURS[j]}
                  </label>
                </td>
                <td className="py-1">
                  {jours[j].ouvert ? (
                    <span className="flex items-center gap-2">
                      <label className="sr-only" htmlFor={`ouv-${siteId}-${j}`}>
                        Ouverture le {JOURS[j].toLowerCase()}
                      </label>
                      <input id={`ouv-${siteId}-${j}`} type="time" step={900} className="champ" value={jours[j].ouverture} onChange={(e) => maj(j, { ouverture: e.target.value })} />
                      <span aria-hidden>–</span>
                      <label className="sr-only" htmlFor={`ferm-${siteId}-${j}`}>
                        Fermeture le {JOURS[j].toLowerCase()}
                      </label>
                      <input id={`ferm-${siteId}-${j}`} type="time" step={900} className="champ" value={jours[j].fermeture} onChange={(e) => maj(j, { fermeture: e.target.value })} />
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
          <button type="submit" className="bouton-secondaire" disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer les horaires"}
          </button>
          {ouverts > 1 && (
            <button
              type="button"
              className="lien text-sm"
              onClick={() => {
                const premier = [1, 2, 3, 4, 5, 6, 7].find((j) => jours[j].ouvert)!;
                const { ouverture, fermeture } = jours[premier];
                setJours(Object.fromEntries(Object.entries(jours).map(([k, v]) => [k, v.ouvert ? { ...v, ouverture, fermeture } : v])) as Record<number, Jour>);
              }}
            >
              Mêmes heures pour tous les jours ouverts
            </button>
          )}
          <span role="status" className={`text-sm ${message?.ok === false ? "text-erreur" : "text-doux"}`}>
            {message?.texte}
          </span>
        </div>
      </form>
    </details>
  );
}
