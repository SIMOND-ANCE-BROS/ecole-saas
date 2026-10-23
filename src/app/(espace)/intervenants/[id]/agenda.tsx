"use client";

import { useState, useTransition } from "react";
import { createCalendarLink, disconnectCalendar, revokeCalendarLink, syncNow } from "../actions";

const shortDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

/**
 * Lien d'abonnement à l'agenda de l'intervenant. L'adresse n'est montrée qu'à
 * sa création (seule son empreinte est gardée) : la recréer remplace l'ancienne.
 */
type Connection = { provider: string; account: string | null; lastSyncedAt: string | null; error: string | null };

export function CalendarSubscription({
  instructorId: instructorId,
  firstName: firstName,
  activeSince: activeSince,
  connection: connection,
}: {
  instructorId: string;
  firstName: string;
  activeSince: string | null;
  connection: Connection | null;
}) {
  const [url, setUrl] = useState<{ url: string; page: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copy, setCopy] = useState(false);
  const [inProgress, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      const r = await createCalendarLink(instructorId);
      if ("url" in r) {
        setUrl(r);
        setMessage(null);
        setCopy(false);
      } else setMessage(r.message);
    });

  return (
    <section aria-labelledby="agenda" className="panneau flex w-full min-w-0 flex-col gap-3 p-4 text-sm">
      <div>
        <h2 id="agenda" className="text-base font-semibold">
          Agenda de {firstName}
        </h2>
        <p className="text-doux">
          Une page privée pour {firstName} : s’abonner à ses séances (Google, Apple, Outlook) et connecter son agenda
          pour que ses indisponibilités remontent ici. Aucun nom d’élève n’en sort ; seules ses plages occupées y
          entrent.
        </p>
      </div>

      {url ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="lien-agenda" className="font-medium">
            Page à transmettre à {firstName} (affichée une seule fois)
          </label>
          <div className="flex gap-2">
            <input
              id="lien-agenda"
              readOnly
              className="champ min-w-0 flex-1 font-mono text-xs"
              value={url.page}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="bouton-secondaire shrink-0"
              onClick={async () => {
                await navigator.clipboard.writeText(url.page);
                setCopy(true);
              }}
            >
              {copy ? "Copié" : "Copier"}
            </button>
          </div>
          <p className="text-doux">
            Abonnement direct, sans la page : <span className="font-mono text-xs break-all">{url.url}</span>
          </p>
          <ul className="list-disc pl-5 text-doux">
            <li>Google Agenda (ordinateur) : « Autres agendas », « + », « À partir de l’URL », puis coller le lien.</li>
            <li>
              iPhone : Réglages, Calendrier, Comptes, « Ajouter un compte », « Autre », « Ajouter un calendrier avec
              abonnement ».
            </li>
            <li>Outlook : « Ajouter un calendrier », « S’abonner à partir du web ».</li>
          </ul>
          <p className="text-doux">Les agendas se mettent à jour toutes les quelques heures (selon l’application).</p>
        </div>
      ) : (
        <p>
          {activeSince
            ? `Lien actif depuis le ${shortDate.format(new Date(activeSince))}.`
            : "Aucun lien pour l’instant."}
        </p>
      )}

      {connection ? (
        <div className="flex flex-col gap-1 rounded-md border border-bordure p-3">
          <p>
            Agenda connecté : {connection.provider}
            {connection.account && ` (${connection.account})`}.
          </p>
          {connection.error ? (
            <p className="text-alerte-texte">{connection.error}</p>
          ) : (
            connection.lastSyncedAt && (
              <p className="text-doux">Dernière mise à jour : {dateTime.format(new Date(connection.lastSyncedAt))}.</p>
            )
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="bouton-secondaire"
              disabled={inProgress}
              onClick={() => startTransition(async () => setMessage((await syncNow(instructorId)).message))}
            >
              Synchroniser maintenant
            </button>
            <button
              type="button"
              className="bouton-secondaire"
              disabled={inProgress}
              onClick={() => startTransition(async () => setMessage((await disconnectCalendar(instructorId)).message))}
            >
              Déconnecter
            </button>
          </div>
        </div>
      ) : (
        activeSince && <p className="text-doux">Aucun agenda connecté par {firstName} pour l’instant.</p>
      )}

      {message && (
        <p role="status" className="font-medium">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="bouton-principal" disabled={inProgress} onClick={create}>
          {activeSince || url ? "Remplacer le lien" : "Créer le lien"}
        </button>
        {(activeSince || url) && (
          <button
            type="button"
            className="bouton-secondaire"
            disabled={inProgress}
            onClick={() =>
              startTransition(async () => {
                const r = await revokeCalendarLink(instructorId);
                setMessage(r.message);
                if (!r.message) setUrl(null);
              })
            }
          >
            Révoquer
          </button>
        )}
      </div>
      {(activeSince || url) && (
        <p className="text-xs text-doux">Remplacer ou révoquer le lien coupe aussitôt l’ancien abonnement.</p>
      )}
    </section>
  );
}
