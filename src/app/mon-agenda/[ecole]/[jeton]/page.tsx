import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PROVIDERS, credentials, PROVIDER_NAME } from "@/connectors/calendar/oauth";
import { withSchool } from "@/db";
import { tokenInstructor } from "@/db/calendar-feed";
import { connectionState } from "@/db/calendar-connections";
import { publicAddress } from "@/lib/public-calendar";
import { DisconnectButton } from "./disconnect-button";

export const metadata: Metadata = { title: "Mon agenda", robots: { index: false, follow: false } };

const BANNERS: Record<string, { text: string; error: boolean }> = {
  connecte: { text: "Agenda connecté : vos indisponibilités sont transmises à l’école.", error: false },
  refuse: { text: "Connexion annulée : rien n’a été transmis.", error: true },
  erreur: { text: "La connexion n’a pas abouti. Réessayez dans quelques minutes.", error: true },
};
const dateTime = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

/**
 * An instructor's personal page, opened through their private link (no account):
 * subscription to their lessons and connection of their calendar.
 */
export default async function MyCalendarPage({ params, searchParams }: PageProps<"/mon-agenda/[ecole]/[jeton]">) {
  const [{ ecole, jeton }, { agenda: status }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(ecole).success) notFound();
  const donnees = await withSchool(ecole, async (tx) => {
    const i = await tokenInstructor(tx, jeton);
    return i ? { instructor: i, connection: await connectionState(tx, i.id) } : null;
  });
  if (!donnees) notFound();
  const { instructor: instructor, connection: connection } = donnees;
  const ics = `${publicAddress()}/agenda/${ecole}/${jeton}.ics`;
  const banner = typeof status === "string" ? BANNERS[status] : undefined;
  const available = PROVIDERS.filter((f) => credentials(f));

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-4 sm:p-8">
      <header>
        <p className="text-sm text-doux">{instructor.school}</p>
        <h1 className="titre-page">Bonjour {instructor.firstName}</h1>
        <p className="text-sm text-doux">Cette page vous est personnelle : ne partagez pas son adresse.</p>
      </header>

      {banner && (
        <p
          role={banner.error ? "alert" : "status"}
          className={`rounded-md px-3 py-2 text-sm ${banner.error ? "bg-alerte-fond text-alerte-texte" : "border border-accent bg-accent-doux"}`}
        >
          {banner.text}
        </p>
      )}

      <section aria-labelledby="seances" className="panneau flex flex-col gap-2 p-4 text-sm">
        <h2 id="seances" className="text-base font-semibold">
          Mes séances dans mon agenda
        </h2>
        <p>
          Ajoutez une fois ce lien à votre agenda : cours, remplacements et annulations s’y mettent à jour d’eux-mêmes.
        </p>
        <a href={ics.replace(/^https?:/, "webcal:")} className="bouton-principal self-start">
          S’abonner à mes séances
        </a>
        <label htmlFor="ics" className="text-doux">
          Ou copiez l’adresse :
        </label>
        <input id="ics" readOnly className="champ font-mono text-xs" value={ics} />
      </section>

      <section aria-labelledby="dispo" className="panneau flex flex-col gap-2 p-4 text-sm">
        <h2 id="dispo" className="text-base font-semibold">
          Mes indisponibilités
        </h2>
        <p>
          Connectez votre agenda pour que l’école voie quand vous n’êtes pas disponible, sans rien d’autre : ni titre,
          ni lieu, ni participant. Cela évite qu’on vous propose un cours ou un remplacement à ces moments-là.
        </p>
        {connection ? (
          <>
            <p className="font-medium">
              Connecté à {PROVIDER_NAME[connection.provider]}
              {connection.account && ` (${connection.account})`}.
            </p>
            {connection.error ? (
              <p className="text-alerte-texte">{connection.error}</p>
            ) : (
              connection.lastSyncedAt && (
                <p className="text-doux">Dernière mise à jour le {dateTime.format(connection.lastSyncedAt)}.</p>
              )
            )}
            <DisconnectButton schoolId={ecole} token={jeton} />
          </>
        ) : available.length === 0 ? (
          <p className="text-doux">
            La connexion des agendas n’est pas encore ouverte. Prévenez l’école de vos absences.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.map((f) => (
              <a key={f} href={`/mon-agenda/${ecole}/${jeton}/connecter/${f}`} className="bouton-secondaire">
                Connecter {PROVIDER_NAME[f]}
              </a>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
