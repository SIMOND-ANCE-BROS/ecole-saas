import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FOURNISSEURS, identifiants, NOM_FOURNISSEUR } from "@/connecteurs/agenda/oauth";
import { avecEcole } from "@/db";
import { intervenantDuJeton } from "@/db/agenda";
import { etatConnexion } from "@/db/connexions-agenda";
import { adressePublique } from "@/lib/agenda-public";
import { BoutonDeconnecter } from "./deconnecter";

export const metadata: Metadata = { title: "Mon agenda", robots: { index: false, follow: false } };

const BANDEAUX: Record<string, { texte: string; erreur: boolean }> = {
  connecte: { texte: "Agenda connecté : vos indisponibilités sont transmises à l’école.", erreur: false },
  refuse: { texte: "Connexion annulée : rien n’a été transmis.", erreur: true },
  erreur: { texte: "La connexion n’a pas abouti. Réessayez dans quelques minutes.", erreur: true },
};
const dateHeure = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

/**
 * Page personnelle d'un intervenant, ouverte par son lien privé (sans compte) :
 * abonnement à ses séances et connexion de son agenda.
 */
export default async function PageMonAgenda({ params, searchParams }: PageProps<"/mon-agenda/[ecole]/[jeton]">) {
  const [{ ecole, jeton }, { agenda: statut }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(ecole).success) notFound();
  const donnees = await avecEcole(ecole, async (tx) => {
    const i = await intervenantDuJeton(tx, jeton);
    return i ? { intervenant: i, connexion: await etatConnexion(tx, i.id) } : null;
  });
  if (!donnees) notFound();
  const { intervenant, connexion } = donnees;
  const ics = `${adressePublique()}/agenda/${ecole}/${jeton}.ics`;
  const bandeau = typeof statut === "string" ? BANDEAUX[statut] : undefined;
  const disponibles = FOURNISSEURS.filter((f) => identifiants(f));

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-4 sm:p-8">
      <header>
        <p className="text-sm text-doux">{intervenant.ecole}</p>
        <h1 className="titre-page">Bonjour {intervenant.prenom}</h1>
        <p className="text-sm text-doux">Cette page vous est personnelle : ne partagez pas son adresse.</p>
      </header>

      {bandeau && (
        <p
          role={bandeau.erreur ? "alert" : "status"}
          className={`rounded-md px-3 py-2 text-sm ${bandeau.erreur ? "bg-alerte-fond text-alerte-texte" : "border border-accent bg-accent-doux"}`}
        >
          {bandeau.texte}
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
        {connexion ? (
          <>
            <p className="font-medium">
              Connecté à {NOM_FOURNISSEUR[connexion.fournisseur]}
              {connexion.compte && ` (${connexion.compte})`}.
            </p>
            {connexion.erreur ? (
              <p className="text-alerte-texte">{connexion.erreur}</p>
            ) : (
              connexion.derniereSynchro && (
                <p className="text-doux">Dernière mise à jour le {dateHeure.format(connexion.derniereSynchro)}.</p>
              )
            )}
            <BoutonDeconnecter ecoleId={ecole} jeton={jeton} />
          </>
        ) : disponibles.length === 0 ? (
          <p className="text-doux">
            La connexion des agendas n’est pas encore ouverte. Prévenez l’école de vos absences.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {disponibles.map((f) => (
              <a key={f} href={`/mon-agenda/${ecole}/${jeton}/connecter/${f}`} className="bouton-secondaire">
                Connecter {NOM_FOURNISSEUR[f]}
              </a>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
