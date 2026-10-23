import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { avecEcole } from "@/db";
import { libellesCoursSaison, listerContacts, listerEleves, RESULTATS_MAX } from "@/db/eleves";
import { saisonCourante } from "@/db/planning";
import { lirePreference } from "@/db/preferences";
import { nomAffiche } from "@/db/personnes";
import { COLONNES_ELEVES } from "@/domaine/filtres/colonnes";
import { lireFiltre, lireTri } from "@/domaine/filtres/filtres";
import { ageAu, aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";
import { TableauListe } from "../_filtres/tableau-liste";
import { ResultatsNavigables } from "../_personnes/resultats";
import { Telephone } from "../_personnes/sections";

export const metadata: Metadata = { title: "Élèves" };

/** Élèves de l'école ; une recherche montre aussi les contacts qui correspondent (parent, payeur). */
export default async function PageEleves({ searchParams }: PageProps<"/eleves">) {
  const { ecoleId, userId } = await exigerRole("direction", "accueil");
  const { q, f, mode, sort, order } = await searchParams;
  const saisie = typeof q === "string" ? q.trim() : "";
  const filtre = lireFiltre(f, mode, COLONNES_ELEVES);
  const tri = lireTri(sort, order, COLONNES_ELEVES);
  const filtrage = filtre.conditions.length > 0;
  const aujourdhui = aujourdhuiAParis();
  const { eleves, contacts, disposition, cours } = await avecEcole(ecoleId, async (tx) => {
    const saison = await saisonCourante(tx, aujourdhui);
    return {
      eleves: await listerEleves(tx, saisie, { filtre, tri, aujourdhui, saisonId: saison?.id }),
      cours: saison ? await libellesCoursSaison(tx, saison.id) : [],
      contacts: saisie ? await listerContacts(tx, saisie) : [],
      disposition: await lirePreference(tx, userId, "eleves"),
    };
  });
  const messageVide =
    saisie.length === 1
      ? "Tapez au moins deux caractères."
      : filtrage
        ? "Aucun élève ne correspond à ces filtres."
        : saisie
          ? `Aucun élève ne correspond à « ${saisie} ».`
          : "Aucun élève pour l’instant.";
  const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titre-page">Élèves</h1>
          <p className="text-sm text-doux" aria-live="polite">
            {saisie ? `${pluriel(eleves.length, "élève")} pour « ${saisie} »` : pluriel(eleves.length, "élève")}
            {filtrage && " avec ces filtres"}
            {eleves.length >= RESULTATS_MAX &&
              ` : seuls les ${RESULTATS_MAX} premiers sont affichés, précisez la recherche ou filtrez`}
            {!saisie && !filtrage && (
              <span className="hidden sm:inline">. Recherche par nom, téléphone, ou nom d’un parent (Ctrl K).</span>
            )}
          </p>
        </div>
        <Link href="/eleves/nouveau" className="bouton-principal">
          Nouvel élève
        </Link>
      </div>

      <ResultatsNavigables>
        {/* useSearchParams exige une frontière Suspense. */}
        <Suspense>
          <TableauListe
            liste="eleves"
            quoi="les élèves"
            legende="Élèves"
            colonnes={COLONNES_ELEVES}
            disposition={disposition}
            lien="nom"
            vide={messageVide}
            choix={{ cours }}
            actionVide={
              !saisie && (
                <Link href="/eleves/nouveau" className="bouton-principal">
                  Nouvel élève
                </Link>
              )
            }
            lignes={eleves.map((e) => ({
              id: e.id,
              href: `/eleves/${e.id}`,
              cellules: {
                nom: [e.prenom, e.nom].filter(Boolean).join(" "),
                age: e.dateNaissance ? ageAu(e.dateNaissance, aujourdhui) : null,
                responsables: e.responsables,
                facture: e.factureA,
                telephone: e.telephone,
                naissance: e.dateNaissance,
                email: e.email,
                cours: e.cours,
                inscription: e.inscription,
                prevenir: e.prevenir,
              },
            }))}
            mobile={
              eleves.length === 0 ? (
                <p className="text-sm">{messageVide}</p>
              ) : (
                <ul className="panneau divide-y divide-bordure">
                  {eleves.map((e) => (
                    <li key={e.id} className="flex flex-col gap-0.5 px-3 py-2.5 text-sm">
                      <span className="flex items-baseline justify-between gap-2">
                        <Link href={`/eleves/${e.id}`} className="lien text-base font-medium">
                          {[e.prenom, e.nom].filter(Boolean).join(" ")}
                        </Link>
                        {e.dateNaissance && (
                          <span className="shrink-0 tabular-nums text-doux">
                            {ageAu(e.dateNaissance, aujourdhui)} ans
                          </span>
                        )}
                      </span>
                      {e.responsables.length > 0 && (
                        <span className="text-doux">Responsable : {e.responsables.join(", ")}</span>
                      )}
                      {e.telephone && (
                        <span className="self-start py-1">
                          <Telephone numero={e.telephone} />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )
            }
          />
        </Suspense>

        {contacts.length > 0 && (
          <section aria-labelledby="contacts-trouves" className="mt-6 flex flex-col gap-2">
            <h2 id="contacts-trouves" className="text-base font-semibold">
              Contacts pour « {saisie} »
            </h2>
            <ul className="panneau divide-y divide-bordure text-sm">
              {contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                  <Link href={`/contacts/${c.id}`} data-resultat className="lien font-medium">
                    {nomAffiche(c)}
                  </Link>
                  {c.eleves.length > 0 && <span className="text-doux">pour {c.eleves.join(", ")}</span>}
                  {c.telephone && <span className="ml-auto tabular-nums">{c.telephone}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </ResultatsNavigables>
    </section>
  );
}
