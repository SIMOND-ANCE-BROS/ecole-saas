import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { avecEcole } from "@/db";
import { listerIntervenants, MODES_REMUNERATION, STATUTS } from "@/db/intervenants";
import { lirePreference } from "@/db/preferences";
import { saisonCourante } from "@/db/planning";
import { COLONNES_INTERVENANTS } from "@/domaine/filtres/colonnes";
import { appliquerFiltre, type Cellule, lireFiltre } from "@/domaine/filtres/filtres";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { formaterEuros } from "@/lib/montant";
import { exigerRole } from "@/lib/session";
import { TableauListe } from "../_filtres/tableau-liste";

export const metadata: Metadata = { title: "Intervenants" };

export default async function PageIntervenants({ searchParams }: PageProps<"/intervenants">) {
  const { ecoleId, role, userId } = await exigerRole("direction", "accueil");
  const { enregistre, f, mode } = await searchParams;
  const { saison, intervenants, disposition } = await avecEcole(ecoleId, async (tx) => {
    const s = await saisonCourante(tx, aujourdhuiAParis());
    return { saison: s, intervenants: s ? await listerIntervenants(tx, s.id) : [], disposition: await lirePreference(tx, userId, "intervenants") };
  });
  const direction = role === "direction";
  // Le tarif des intervenants n'est montré qu'à la direction.
  const colonnes = direction ? COLONNES_INTERVENANTS : COLONNES_INTERVENANTS.filter((c) => c.id !== "tarif");
  // Liste complète déjà chargée (quelques intervenants) : filtrage en mémoire, mêmes règles qu'en SQL.
  const filtre = lireFiltre(f, mode, COLONNES_INTERVENANTS);
  const valeurs: Record<string, (i: (typeof intervenants)[number]) => Cellule> = {
    nom: (i) => `${i.prenom} ${i.nom}`,
    statut: (i) => STATUTS[i.statut],
    cours: (i) => i.coursSaison,
    email: (i) => i.email,
  };
  const visibles = appliquerFiltre(intervenants, filtre, colonnes.map((c) => ({ ...c, valeur: valeurs[c.id] ?? (() => null) })));
  const confirme = intervenants.find((i) => i.id === enregistre);

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titre-page">Intervenants</h1>
          <p className="text-sm text-doux">
            {intervenants.filter((i) => i.actif).length} actif{intervenants.filter((i) => i.actif).length > 1 ? "s" : ""}
            {saison && `, cours de la saison ${saison.libelle}`}
          </p>
        </div>
        {direction && (
          <Link href="/intervenants/nouveau" className="bouton-principal">
            Ajouter un intervenant
          </Link>
        )}
      </div>

      {confirme && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
          {confirme.prenom} {confirme.nom} enregistré.
        </p>
      )}

      {intervenants.length === 0 ? (
        <p className="text-sm text-doux">
          Aucun intervenant pour l’instant.{direction && " Ajoutez les professeurs avant de construire le planning."}
        </p>
      ) : (
        <Suspense>
          <TableauListe
            liste="intervenants"
            quoi="les intervenants"
            legende="Intervenants"
            colonnes={colonnes}
            disposition={disposition}
            lien="nom"
            vide="Aucun intervenant ne correspond à ces filtres."
            lignes={visibles.map((i) => ({
              id: i.id,
              href: direction ? `/intervenants/${i.id}` : undefined,
              attenue: !i.actif,
              marque: i.actif ? undefined : "inactif",
              cellules: {
                nom: `${i.prenom} ${i.nom}`,
                statut: STATUTS[i.statut],
                cours: i.coursSaison,
                // Jamais envoyé au navigateur de l'accueil : masquer la colonne ne suffit pas.
                ...(direction ? { tarif: `${formaterEuros(i.tarifCentimes)} ${MODES_REMUNERATION[i.modeRemuneration]}` } : {}),
                email: i.email,
              },
            }))}
          />
        </Suspense>
      )}
    </section>
  );
}
