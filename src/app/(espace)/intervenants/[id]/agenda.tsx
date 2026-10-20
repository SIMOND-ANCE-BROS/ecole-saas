"use client";

import { useState, useTransition } from "react";
import { creerLienAgenda, revoquerLienAgenda } from "../actions";

const dateCourte = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/**
 * Lien d'abonnement à l'agenda de l'intervenant. L'adresse n'est montrée qu'à
 * sa création (seule son empreinte est gardée) : la recréer remplace l'ancienne.
 */
export function AbonnementAgenda({ intervenantId, prenom, actifDepuis }: { intervenantId: string; prenom: string; actifDepuis: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const [enCours, demarrer] = useTransition();

  const creer = () =>
    demarrer(async () => {
      const r = await creerLienAgenda(intervenantId);
      if ("url" in r) {
        setUrl(r.url);
        setMessage(null);
        setCopie(false);
      } else setMessage(r.message);
    });

  return (
    <section aria-labelledby="agenda" className="panneau flex max-w-2xl flex-col gap-3 p-4 text-sm">
      <div>
        <h2 id="agenda" className="text-base font-semibold">
          Agenda de {prenom}
        </h2>
        <p className="text-doux">
          Un lien privé que {prenom} ajoute une fois à son agenda (Google, Apple, Outlook). Ses séances, remplacements et annulations
          y apparaissent ensuite d’eux-mêmes, sans nom d’élève.
        </p>
      </div>

      {url ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="lien-agenda" className="font-medium">
            Lien à transmettre à {prenom} (affiché une seule fois)
          </label>
          <div className="flex gap-2">
            <input id="lien-agenda" readOnly className="champ min-w-0 flex-1 font-mono text-xs" value={url} onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="bouton-secondaire shrink-0"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopie(true);
              }}
            >
              {copie ? "Copié" : "Copier"}
            </button>
          </div>
          <ul className="list-disc pl-5 text-doux">
            <li>Google Agenda (ordinateur) : « Autres agendas », « + », « À partir de l’URL », puis coller le lien.</li>
            <li>iPhone : Réglages, Calendrier, Comptes, « Ajouter un compte », « Autre », « Ajouter un calendrier avec abonnement ».</li>
            <li>Outlook : « Ajouter un calendrier », « S’abonner à partir du web ».</li>
          </ul>
          <p className="text-doux">Les agendas se mettent à jour toutes les quelques heures (selon l’application).</p>
        </div>
      ) : (
        <p>
          {actifDepuis
            ? `Lien actif depuis le ${dateCourte.format(new Date(actifDepuis))}.`
            : "Aucun lien pour l’instant."}
        </p>
      )}

      {message && (
        <p role="alert" className="text-erreur">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="bouton-principal" disabled={enCours} onClick={creer}>
          {actifDepuis || url ? "Remplacer le lien" : "Créer le lien"}
        </button>
        {(actifDepuis || url) && (
          <button
            type="button"
            className="bouton-secondaire"
            disabled={enCours}
            onClick={() =>
              demarrer(async () => {
                const r = await revoquerLienAgenda(intervenantId);
                setMessage(r.message);
                if (!r.message) setUrl(null);
              })
            }
          >
            Révoquer
          </button>
        )}
      </div>
      {(actifDepuis || url) && <p className="text-xs text-doux">Remplacer ou révoquer le lien coupe aussitôt l’ancien abonnement.</p>}
    </section>
  );
}
