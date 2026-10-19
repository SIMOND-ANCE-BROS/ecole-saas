import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lireDanseur } from "@/db/danseurs";
import { ageAu, aujourdhuiAParis } from "@/domaine/familles/age";
import { exigerRole } from "@/lib/session";
import { JOURS } from "../../planning/format";

export const metadata: Metadata = { title: "Fiche danseur" };

const STATUT = {
  active: "Inscrit",
  essai: "À l’essai",
  liste_attente: "En attente",
  abandon: "Abandon",
  terminee: "Terminé",
} as const;
const DOCUMENT = {
  certificat_medical: "Certificat médical",
  autorisation_parentale: "Autorisation parentale",
  droit_image: "Droit à l’image",
  autre: "Autre document",
} as const;

const dateLongue = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const jourDe = (iso: string) => dateLongue.format(new Date(`${iso}T00:00:00Z`));
const tel = (numero: string) => (
  <a href={`tel:${numero.replace(/\s/g, "")}`} className="lien tabular-nums">
    {numero}
  </a>
);

export default async function PageDanseur({ params, searchParams }: PageProps<"/danseurs/[id]">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const [{ id }, { enregistre }] = await Promise.all([params, searchParams]);
  const danseur = await avecEcole(ecoleId, (tx) => lireDanseur(tx, id));
  if (!danseur) notFound();
  const aujourdhui = aujourdhuiAParis();

  const nom = `${danseur.prenom} ${danseur.nom}`;
  const age = danseur.dateNaissance ? ageAu(danseur.dateNaissance, aujourdhui) : null;
  const saisonRecente = danseur.cours[0]?.saison;
  const coursActuels = danseur.cours.filter((c) => c.saison === saisonRecente);
  const historique = danseur.cours.filter((c) => c.saison !== saisonRecente);

  return (
    <article className="flex max-w-4xl flex-col gap-5">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href={`/familles/${danseur.famille.id}`} className="lien">
          {danseur.famille.nom}
        </Link>
        <span className="text-doux"> / {nom}</span>
      </nav>

      {enregistre && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
          Fiche enregistrée.
        </p>
      )}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titre-page">{nom}</h1>
          <p className="text-sm text-doux">
            {danseur.dateNaissance ? `${age} ans, né(e) le ${jourDe(danseur.dateNaissance)}` : "Date de naissance non renseignée"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/danseurs/${danseur.id}/modifier`} className="bouton-secondaire">
            Modifier
          </Link>
          <Link href={`/familles/${danseur.famille.id}/inscription`} className="bouton-principal">
            Inscrire
          </Link>
        </div>
      </header>

      {danseur.notes && (
        <section aria-label="Notes" className="rounded-md border border-alerte-texte/40 bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">
          <p className="whitespace-pre-line">{danseur.notes}</p>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="famille" className="panneau flex flex-col gap-1 p-4 text-sm">
          <h2 id="famille" className="text-xs text-doux">
            Famille
          </h2>
          <Link href={`/familles/${danseur.famille.id}`} className="lien font-medium">
            {danseur.famille.nom}
          </Link>
          {danseur.famille.telephone && tel(danseur.famille.telephone)}
          {danseur.famille.email && (
            <a href={`mailto:${danseur.famille.email}`} className="lien">
              {danseur.famille.email}
            </a>
          )}
        </section>
        <section aria-labelledby="urgence" className="panneau flex flex-col gap-1 p-4 text-sm">
          <h2 id="urgence" className="text-xs text-doux">
            En cas d’urgence
          </h2>
          {danseur.contactUrgence || danseur.telephoneUrgence ? (
            <>
              {danseur.contactUrgence && <span className="font-medium">{danseur.contactUrgence}</span>}
              {danseur.telephoneUrgence && tel(danseur.telephoneUrgence)}
            </>
          ) : (
            <span className="text-doux">
              Non renseigné.{" "}
              <Link href={`/danseurs/${danseur.id}/modifier`} className="lien">
                Compléter
              </Link>
            </span>
          )}
        </section>
      </div>

      <section aria-labelledby="cours" className="flex flex-col gap-2">
        <h2 id="cours" className="text-base font-semibold">
          Cours{saisonRecente && ` ${saisonRecente}`}
        </h2>
        {coursActuels.length === 0 ? (
          <p className="text-sm text-doux">Aucun cours pour l’instant.</p>
        ) : (
          <ul className="panneau divide-y divide-bordure text-sm">
            {coursActuels.map((c) => (
              <li key={`${c.id}-${c.statut}`} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                <Link href={`/planning/cours/${c.id}`} className="lien font-medium">
                  {c.discipline}
                  {c.niveau && ` ${c.niveau}`}
                </Link>
                <span className="tabular-nums">
                  {c.jourSemaine ? JOURS[c.jourSemaine] : "Stage"} {c.heureDebut}
                </span>
                <span className={`ml-auto text-xs ${c.statut === "active" ? "text-doux" : "font-medium text-alerte-texte"}`}>
                  {STATUT[c.statut]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="documents" className="flex flex-col gap-2">
        <h2 id="documents" className="text-base font-semibold">
          Documents
        </h2>
        {danseur.documents.length === 0 ? (
          <p className="text-sm text-doux">Aucun document enregistré (certificat médical, autorisations).</p>
        ) : (
          <ul className="panneau divide-y divide-bordure text-sm">
            {danseur.documents.map((d, i) => {
              const expire = d.valideJusqu !== null && d.valideJusqu < aujourdhui;
              return (
                <li key={i} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                  <span className="font-medium">{DOCUMENT[d.type]}</span>
                  <span className={expire || !d.accorde ? "text-alerte-texte" : "text-doux"}>
                    {!d.accorde ? "refusé" : d.valideJusqu ? `${expire ? "expiré le" : "valable jusqu’au"} ${jourDe(d.valideJusqu)}` : "fourni"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {historique.length > 0 && (
        <section aria-labelledby="historique" className="flex flex-col gap-2">
          <h2 id="historique" className="text-base font-semibold">
            Saisons précédentes
          </h2>
          <ul className="flex flex-col gap-1 text-sm text-doux">
            {historique.map((c) => (
              <li key={`${c.id}-${c.statut}`}>
                {c.saison} : {c.discipline}
                {c.niveau && ` ${c.niveau}`} ({STATUT[c.statut].toLowerCase()})
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
