import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { avecEcole } from "@/db";
import { listerContacts } from "@/db/eleves";
import { lirePreference } from "@/db/preferences";
import { nomAffiche } from "@/db/personnes";
import { COLONNES_CONTACTS } from "@/domaine/filtres/colonnes";
import { lireFiltre, lireTri } from "@/domaine/filtres/filtres";
import { exigerRole } from "@/lib/session";
import { RechercheListe } from "../_filtres/recherche-liste";
import { TableauListe } from "../_filtres/tableau-liste";
import { ResultatsNavigables } from "../_personnes/resultats";

export const metadata: Metadata = { title: "Contacts" };

/** Parents, payeurs et organismes (CSE, entreprises). */
export default async function PageContacts({ searchParams }: PageProps<"/contacts">) {
  const { ecoleId, userId } = await exigerRole("direction", "accueil");
  const { q, f, mode, sort, order } = await searchParams;
  const saisie = typeof q === "string" ? q.trim() : "";
  const filtre = lireFiltre(f, mode, COLONNES_CONTACTS);
  const { contacts, disposition } = await avecEcole(ecoleId, async (tx) => ({
    contacts: await listerContacts(tx, saisie, { filtre, tri: lireTri(sort, order, COLONNES_CONTACTS) }),
    disposition: await lirePreference(tx, userId, "contacts"),
  }));

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titre-page">Contacts</h1>
          <p className="text-sm text-doux">Parents, responsables, payeurs et organismes (CSE, entreprises).</p>
        </div>
        <Link href="/contacts/nouveau" className="bouton-principal">
          Nouveau contact
        </Link>
      </div>
      <Suspense>
        <RechercheListe libelle="Rechercher un contact" exemple="Nom, téléphone, e-mail…" />
      </Suspense>
      <ResultatsNavigables>
        <Suspense>
          <TableauListe
            liste="contacts"
            quoi="les contacts"
            legende="Contacts"
            colonnes={COLONNES_CONTACTS}
            disposition={disposition}
            lien="nom"
            vide={filtre.conditions.length > 0 ? "Aucun contact ne correspond à ces filtres." : saisie ? `Aucun contact ne correspond à « ${saisie} ».` : "Aucun contact pour l’instant."}
            actionVide={
              <Link href="/contacts/nouveau" className="bouton-principal">
                Nouveau contact
              </Link>
            }
            lignes={contacts.map((c) => ({
              id: c.id,
              href: `/contacts/${c.id}`,
              marque: c.type === "professionnel" ? "organisme" : undefined,
              cellules: { nom: nomAffiche(c), eleves: c.eleves, telephone: c.telephone, email: c.email },
            }))}
          />
        </Suspense>
      </ResultatsNavigables>
    </section>
  );
}
