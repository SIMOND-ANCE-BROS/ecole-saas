import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lireContact } from "@/db/eleves";
import { inscriptionsPayeesPar } from "@/db/inscriptions";
import { nomAffiche } from "@/db/personnes";
import { saisonCourante } from "@/db/planning";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";
import { Bandeau, InscriptionsFacturees, Telephone } from "../../_personnes/sections";
import { DevenirEleve } from "./devenir-eleve";

export const metadata: Metadata = { title: "Fiche contact" };

const BANDEAUX: Record<string, string> = { cree: "Contact créé.", modifie: "Fiche enregistrée." };

export default async function PageContact({ params, searchParams }: PageProps<"/contacts/[id]">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const [{ id }, { enregistre }] = await Promise.all([params, searchParams]);
  const aujourdhui = aujourdhuiAParis();
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const contact = await lireContact(tx, id);
    if (!contact) return null;
    const saison = await saisonCourante(tx, aujourdhui);
    return { contact, saison, facturees: saison ? await inscriptionsPayeesPar(tx, contact.id, saison.id) : [] };
  });
  if (!donnees) notFound();
  const { contact: c, saison, facturees } = donnees;
  const nom = nomAffiche(c);
  const prenom = c.prenom ?? nom;
  const roles = (e: (typeof c.eleves)[number]) =>
    [e.responsable && "responsable", e.paie && "facturé", e.aPrevenir && "à prévenir"].filter(Boolean).join(", ") || "proche";

  return (
    <article className="flex w-full min-w-0 flex-col gap-5">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/contacts" className="lien">
          Contacts
        </Link>
        <span className="text-doux"> / {nom}</span>
      </nav>
      <Bandeau texte={BANDEAUX[String(enregistre)]} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titre-page">{nom}</h1>
          <p className="text-sm text-doux">{c.type === "professionnel" ? `Organisme${c.siren ? `, SIREN ${c.siren}` : ""}` : "Particulier"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/contacts/${c.id}/modifier`} className="bouton-secondaire">
            Modifier
          </Link>
          {c.type === "particulier" &&
            (c.eleve ? (
              <Link href={`/eleves/${c.id}`} className="bouton-secondaire">
                Voir sa fiche élève
              </Link>
            ) : (
              <DevenirEleve id={c.id} prenom={prenom} />
            ))}
        </div>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <aside aria-label="Coordonnées" className="order-first lg:order-last">
          <section aria-labelledby="coordonnees" className="panneau flex flex-col gap-1 p-4 text-sm">
            <h2 id="coordonnees" className="text-sm font-semibold">
              Coordonnées
            </h2>
            {c.telephone ? <Telephone numero={c.telephone} /> : <span className="text-doux">Pas de téléphone</span>}
            {c.email ? (
              <a href={`mailto:${c.email}`} className="lien break-all">
                {c.email}
              </a>
            ) : (
              <span className="text-doux">Pas d’e-mail</span>
            )}
            {c.adresse && <span>{c.adresse}</span>}
          </section>
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="eleves" className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="eleves" className="text-base font-semibold">
                Élèves
              </h2>
              {c.type === "particulier" && (
                <Link href={`/eleves/nouveau?responsable=${c.id}`} className="lien text-sm">
                  Ajouter un enfant
                </Link>
              )}
            </div>
            {c.eleves.length === 0 ? (
              <p className="text-sm text-doux">Rattaché à aucun élève.</p>
            ) : (
              <ul className="panneau divide-y divide-bordure text-sm">
                {c.eleves.map((e) => (
                  <li key={e.lienId} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                    <Link href={`/eleves/${e.id}`} className="lien font-medium">
                      {e.nom}
                    </Link>
                    <span className="text-doux">{roles(e)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {saison && <InscriptionsFacturees inscriptions={facturees} saison={saison.libelle} />}
        </div>
      </div>
    </article>
  );
}
