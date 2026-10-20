"use client";

import { useState, useTransition } from "react";
import type { Fermeture } from "@/db/seances";
import { fermer, mettreAJourSeances, rouvrir } from "../seances/actions";

const dateCourte = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const jour = (iso: string) => dateCourte.format(new Date(`${iso}T00:00:00Z`));

type Props = { fermetures: Fermeture[]; debutSaison: string; finSaison: string };

export function GestionFermetures({ fermetures, debutSaison, finSaison }: Props) {
  const [v, setV] = useState({ libelle: "", debut: "", fin: "" });
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [enCours, demarrer] = useTransition();

  const agir = (action: () => Promise<{ message: string | null }>, succes: string, apres?: () => void) =>
    demarrer(async () => {
      const { message: erreur } = await action();
      setMessage(erreur ? { texte: erreur, erreur: true } : { texte: succes, erreur: false });
      if (!erreur) apres?.();
    });

  return (
    <div className="flex flex-col gap-5">
      <form
        className="panneau grid gap-3 p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          agir(() => fermer({ ...v, fin: v.fin || v.debut }), "Fermeture ajoutée, séances mises à jour.", () => setV({ libelle: "", debut: "", fin: "" }));
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="libelle" className="text-sm font-medium">
            Libellé
          </label>
          <input id="libelle" className="champ" placeholder="Vacances de la Toussaint" autoFocus value={v.libelle} onChange={(e) => setV({ ...v, libelle: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="debut" className="text-sm font-medium">
            Du
          </label>
          <input id="debut" type="date" className="champ" min={debutSaison} max={finSaison} value={v.debut} onChange={(e) => setV({ ...v, debut: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="fin" className="text-sm font-medium">
            Au (inclus)
          </label>
          <input id="fin" type="date" className="champ" min={v.debut || debutSaison} max={finSaison} value={v.fin} onChange={(e) => setV({ ...v, fin: e.target.value })} />
        </div>
        <button type="submit" className="bouton-principal" disabled={enCours}>
          Ajouter
        </button>
      </form>

      {message && (
        <p role={message.erreur ? "alert" : "status"} className={`text-sm ${message.erreur ? "text-erreur" : ""}`}>
          {message.texte}
        </p>
      )}

      {fermetures.length === 0 ? (
        <p className="text-sm text-doux">Aucune fermeture pour cette saison. Pensez aux vacances scolaires de votre zone et aux jours fériés.</p>
      ) : (
        <ul className="panneau divide-y divide-bordure text-sm">
          {fermetures.map((f) => (
            <li key={f.id} className="flex flex-wrap items-baseline gap-x-4 px-3 py-2">
              <span className="font-medium">{f.libelle}</span>
              <span className="tabular-nums text-doux">{f.debut === f.fin ? jour(f.debut) : `${jour(f.debut)} au ${jour(f.fin)}`}</span>
              <button
                type="button"
                className="lien ml-auto text-xs text-doux"
                disabled={enCours}
                onClick={() => agir(() => rouvrir(f.id), "Fermeture retirée, séances remises.")}
                aria-label={`Retirer la fermeture ${f.libelle}`}
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3 border-t border-bordure pt-4 text-sm">
        <button type="button" className="bouton-secondaire" disabled={enCours} onClick={() => agir(mettreAJourSeances, "Séances à venir mises à jour.")}>
          Mettre à jour les séances
        </button>
        <span className="text-doux">À utiliser une fois en début de saison, ou après une reprise de données.</span>
      </div>
    </div>
  );
}
