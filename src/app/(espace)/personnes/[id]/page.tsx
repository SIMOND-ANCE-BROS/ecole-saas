import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { inscriptionsPayeesPar } from "@/db/inscriptions";
import { lirePersonne, nomAffiche } from "@/db/personnes";
import { saisonCourante } from "@/db/planning";
import { ageAu, aujourdhuiAParis } from "@/domaine/personnes/age";
import { formaterEuros } from "@/lib/montant";
import { exigerRole } from "@/lib/session";
import { JOURS } from "../../planning/format";
import { LiensPersonne } from "./liens";

export const metadata: Metadata = { title: "Fiche personne" };

const STATUT = { active: "Inscrit", essai: "À l’essai", liste_attente: "En attente", abandon: "Abandon", terminee: "Terminé" } as const;
const DOCUMENT = {
  certificat_medical: "Certificat médical",
  autorisation_parentale: "Autorisation parentale",
  droit_image: "Droit à l’image",
  autre: "Autre document",
} as const;
const PERIODICITE = { trimestre: "trimestre", annee: "année", unite: "unité" } as const;
const PUBLIC = { enfant: "Enfant", adulte: "Adulte", couple: "Couple", etudiant: "Étudiant" } as const;
const BANDEAUX: Record<string, string> = {
  creee: "Personne créée.",
  modifiee: "Fiche enregistrée.",
  ajoute: "Lien ajouté.",
  enregistree: "Inscription enregistrée.",
};

const dateLongue = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const jourDe = (iso: string) => dateLongue.format(new Date(`${iso}T00:00:00Z`));
const tel = (numero: string) => (
  <a href={`tel:${numero.replace(/\s/g, "")}`} className="lien tabular-nums">
    {numero}
  </a>
);

export default async function PagePersonne({ params, searchParams }: PageProps<"/personnes/[id]">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const [{ id }, recherche] = await Promise.all([params, searchParams]);
  const aujourdhui = aujourdhuiAParis();
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const fiche = await lirePersonne(tx, id);
    if (!fiche) return null;
    const saison = await saisonCourante(tx, aujourdhui);
    return { fiche, saison, payees: saison ? await inscriptionsPayeesPar(tx, fiche.id, saison.id) : [] };
  });
  if (!donnees) notFound();
  const { fiche: p, saison, payees } = donnees;

  const nom = nomAffiche(p);
  const prenom = p.prenom ?? nom;
  const age = p.dateNaissance ? ageAu(p.dateNaissance, aujourdhui) : null;
  const bandeau = [recherche.personne, recherche.lien, recherche.inscription].map((v) => BANDEAUX[String(v)]).find(Boolean);

  // Qui peut payer les cours de cette personne : ceux qui paient pour elle, et elle-même si elle est majeure ou sans payeur.
  const payeurs = p.liens.filter((l) => l.sens === "vers" && l.paiePour).map((l) => l.autre);
  const seule = p.type === "particulier" && (payeurs.length === 0 || age === null || age >= 18);
  const inscrire = [...payeurs.map((a) => ({ id: a.id, libelle: `payé par ${a.nom}` })), ...(seule ? [{ id: p.id, libelle: "à ses propres frais" }] : [])];
  const paiePourAutres = p.liens.some((l) => l.sens === "de" && l.paiePour);
  const urgences = p.liens.filter((l) => l.sens === "vers" && l.contactUrgence);

  const saisonRecente = p.cours[0]?.saison;
  const coursActuels = p.cours.filter((c) => c.saison === saisonRecente);
  const historique = p.cours.filter((c) => c.saison !== saisonRecente);
  const totalPrisEnCharge = payees.reduce((s, i) => s + i.prixNetCentimes, 0);

  return (
    <article className="flex w-full min-w-0 flex-col gap-5">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/personnes" className="lien">
          Personnes
        </Link>
        <span className="text-doux"> / {nom}</span>
      </nav>

      {bandeau && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
          {bandeau}
        </p>
      )}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titre-page">{nom}</h1>
          <p className="text-sm text-doux">
            {p.type === "professionnel"
              ? `Professionnel${p.siren ? `, SIREN ${p.siren}` : ""}`
              : p.dateNaissance
                ? `${age} ans, né(e) le ${jourDe(p.dateNaissance)}`
                : "Date de naissance non renseignée"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/personnes/${p.id}/modifier`} className="bouton-secondaire">
            Modifier la fiche
          </Link>
          {inscrire.length === 1 && (
            <Link href={`/personnes/${inscrire[0].id}/inscription?danseur=${p.id}`} className="bouton-principal">
              Inscrire {prenom}
            </Link>
          )}
        </div>
      </header>

      {inscrire.length > 1 && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          Inscrire {prenom} :
          {inscrire.map((o) => (
            <Link key={o.id} href={`/personnes/${o.id}/inscription?danseur=${p.id}`} className="bouton-secondaire">
              {o.libelle}
            </Link>
          ))}
        </p>
      )}
      {p.type === "particulier" && inscrire.length === 0 && (
        <p className="text-sm text-doux">
          Pour inscrire {prenom}, liez d’abord la personne qui paie ses cours (« Ajouter un lien », puis « paie ses cours »).
        </p>
      )}

      {p.notes && (
        <section aria-label="Notes" className="rounded-md border border-alerte-texte/40 bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">
          <p className="whitespace-pre-line">{p.notes}</p>
        </section>
      )}

      <nav aria-label="Sections de la fiche" className="flex flex-wrap gap-2 border-y border-bordure py-2 text-sm">
        <a href="#liens" className="bouton-secondaire">Personnes liées</a>
        {coursActuels.length > 0 && <a href="#cours" className="bouton-secondaire">Cours suivis</a>}
        {(payees.length > 0 || paiePourAutres) && <a href="#payees" className="bouton-secondaire">Prises en charge</a>}
        <a href="#coordonnees" className="bouton-secondaire">Coordonnées</a>
        {(p.documents.length > 0 || p.cours.length > 0) && <a href="#documents" className="bouton-secondaire">Documents</a>}
      </nav>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-5">
      <section aria-labelledby="liens" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="liens" className="text-base font-semibold">
            Personnes liées
          </h2>
          <Link href={`/personnes/${p.id}/liens/nouveau`} className="lien text-sm">
            Ajouter un lien
          </Link>
        </div>
        {p.liens.length === 0 ? (
          <p className="text-sm text-doux">
            Aucun lien. Ajoutez un parent, un conjoint ou l’entreprise qui paie, si besoin : une personne seule n’en a pas besoin.
          </p>
        ) : (
          <LiensPersonne liens={p.liens} prenom={prenom} />
        )}
      </section>

      {coursActuels.length > 0 && (
        <section aria-labelledby="cours" className="flex flex-col gap-2">
          <h2 id="cours" className="text-base font-semibold">
            Cours {saisonRecente}
          </h2>
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
                {c.presents + c.absents > 0 && (
                  <span className={`text-xs ${c.absents > c.presents ? "text-alerte-texte" : "text-doux"}`}>
                    présent {c.presents} fois sur {c.presents + c.absents}
                  </span>
                )}
                <span className={`ml-auto text-xs ${c.statut === "active" ? "text-doux" : "font-medium text-alerte-texte"}`}>
                  {STATUT[c.statut]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(payees.length > 0 || paiePourAutres) && (
        <section aria-labelledby="payees" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="payees" className="text-base font-semibold">
              Inscriptions prises en charge {saison && `· ${saison.libelle}`}
            </h2>
            {saison && (
              <Link href={`/personnes/${p.id}/inscription`} className="lien text-sm">
                Nouvelle inscription
              </Link>
            )}
          </div>
          <p className="text-xs text-doux">Montants des inscriptions à la charge de {prenom}. Ce total ne représente ni un montant encaissé, ni un solde restant dû.</p>
          {payees.length === 0 ? (
            <p className="text-sm text-doux">Aucune inscription pour cette saison.</p>
          ) : (
            <div className="panneau overflow-x-auto">
              <table className="tableau">
                <thead>
                  <tr>
                    <th scope="col">Danseur</th>
                    <th scope="col">Cours</th>
                    <th scope="col" className="hidden sm:table-cell">Formule</th>
                    <th scope="col" className="text-right">
                      Prix
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payees.map((i) => (
                    <tr key={i.id}>
                      <td className="font-medium">{i.danseurs}</td>
                      <td>{i.cours.join(", ")}</td>
                      <td className="hidden sm:table-cell">
                        {PUBLIC[i.public]}, {PERIODICITE[i.periodicite]}
                      </td>
                      <td className="text-right tabular-nums">{formaterEuros(i.prixNetCentimes)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                      Total des inscriptions
                    </td>
                    <td colSpan={2} className="px-3 py-2 text-right font-medium sm:hidden">
                      Total des inscriptions
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formaterEuros(totalPrisEnCharge)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      )}

      {(p.documents.length > 0 || p.cours.length > 0) && (
        <section aria-labelledby="documents" className="flex flex-col gap-2">
          <h2 id="documents" className="text-base font-semibold">
            Documents
          </h2>
          {p.documents.length === 0 ? (
            <p className="text-sm text-doux">Aucun document enregistré (certificat médical, autorisations).</p>
          ) : (
            <ul className="panneau divide-y divide-bordure text-sm">
              {p.documents.map((d, i) => {
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
      )}

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
        </div>
        <aside aria-label="Coordonnées et contacts d’urgence" className="lg:sticky lg:top-20">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <section aria-labelledby="coordonnees" className="panneau flex flex-col gap-1 p-4 text-sm">
          <h2 id="coordonnees" className="text-sm font-semibold">
            Coordonnées
          </h2>
          {p.telephone ? tel(p.telephone) : <span className="text-doux">Pas de téléphone</span>}
          {p.email ? (
            <a href={`mailto:${p.email}`} className="lien">
              {p.email}
            </a>
          ) : (
            <span className="text-doux">Pas d’e-mail</span>
          )}
          {p.adresse && <span>{p.adresse}</span>}
        </section>
        {p.type === "particulier" && (
          <section aria-labelledby="urgence" className="panneau flex flex-col gap-1 p-4 text-sm">
            <h2 id="urgence" className="text-sm font-semibold">
              En cas d’urgence
            </h2>
            {urgences.length === 0 ? (
              <span className="text-doux">Personne n’est indiqué. Cochez « à prévenir » sur un lien ci-dessous.</span>
            ) : (
              urgences.map((l) => (
                <span key={l.id} className="flex flex-wrap gap-x-2">
                  <Link href={`/personnes/${l.autre.id}`} className="lien font-medium">
                    {l.autre.nom}
                  </Link>
                  {l.autre.telephone ? tel(l.autre.telephone) : <span className="text-erreur">sans téléphone</span>}
                </span>
              ))
            )}
          </section>
        )}
      </div>

        </aside>
      </div>
    </article>
  );
}
