"use client";

import { useState, useTransition } from "react";
import { creerLienAgenda, deconnecterAgenda, revoquerLienAgenda, synchroniserMaintenant } from "../actions";

const dateCourte = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const dateHeure = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

/**
 * Lien d'abonnement à l'agenda de l'intervenant. L'adresse n'est montrée qu'à
 * sa création (seule son empreinte est gardée) : la recréer remplace l'ancienne.
 */
type Connexion = { fournisseur: string; compte: string | null; derniereSynchro: string | null; erreur: string | null };

export function AbonnementAgenda({
  intervenantId,
  prenom,
  actifDepuis,
  connexion,
}: {
  intervenantId: string;
  prenom: string;
  actifDepuis: string | null;
  connexion: Connexion | null;
}) {
  const [url, setUrl] = useState<{ url: string; page: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const [enCours, demarrer] = useTransition();

  const creer = () =>
    demarrer(async () => {
      const r = await creerLienAgenda(intervenantId);
      if ("url" in r) {
        setUrl(r);
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
          Une page privée pour {prenom} : s’abonner à ses séances (Google, Apple, Outlook) et connecter son agenda pour que ses
          indisponibilités remontent ici. Aucun nom d’élève n’en sort ; seules ses plages occupées y entrent.
        </p>
      </div>

      {url ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="lien-agenda" className="font-medium">
            Page à transmettre à {prenom} (affichée une seule fois)
          </label>
          <div className="flex gap-2">
            <input id="lien-agenda" readOnly className="champ min-w-0 flex-1 font-mono text-xs" value={url.page} onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="bouton-secondaire shrink-0"
              onClick={async () => {
                await navigator.clipboard.writeText(url.page);
                setCopie(true);
              }}
            >
              {copie ? "Copié" : "Copier"}
            </button>
          </div>
          <p className="text-doux">
            Abonnement direct, sans la page :{" "}
            <span className="font-mono text-xs break-all">{url.url}</span>
          </p>
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

      {connexion ? (
        <div className="flex flex-col gap-1 rounded-md border border-bordure p-3">
          <p>
            Agenda connecté : {connexion.fournisseur}
            {connexion.compte && ` (${connexion.compte})`}.
          </p>
          {connexion.erreur ? (
            <p className="text-alerte-texte">{connexion.erreur}</p>
          ) : (
            connexion.derniereSynchro && <p className="text-doux">Dernière mise à jour : {dateHeure.format(new Date(connexion.derniereSynchro))}.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="bouton-secondaire" disabled={enCours} onClick={() => demarrer(async () => setMessage((await synchroniserMaintenant(intervenantId)).message))}>
              Synchroniser maintenant
            </button>
            <button type="button" className="bouton-secondaire" disabled={enCours} onClick={() => demarrer(async () => setMessage((await deconnecterAgenda(intervenantId)).message))}>
              Déconnecter
            </button>
          </div>
        </div>
      ) : (
        actifDepuis && <p className="text-doux">Aucun agenda connecté par {prenom} pour l’instant.</p>
      )}

      {message && (
        <p role="status" className="font-medium">
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
