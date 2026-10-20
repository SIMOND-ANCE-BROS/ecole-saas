import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lirePersonne, nomAffiche } from "@/db/personnes";
import { exigerRole } from "@/lib/session";
import { ChoixLien } from "./choix";

export const metadata: Metadata = { title: "Ajouter un lien" };

export default async function PageNouveauLien({ params }: PageProps<"/personnes/[id]/liens/nouveau">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const { id } = await params;
  const fiche = await avecEcole(ecoleId, (tx) => lirePersonne(tx, id));
  if (!fiche) notFound();
  const nom = nomAffiche(fiche);

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href={`/personnes/${fiche.id}`} className="lien">
          {nom}
        </Link>
        <span className="text-doux"> / Ajouter un lien</span>
      </nav>
      <h1 className="titre-page">Ajouter un lien à {nom}</h1>
      <ChoixLien ficheId={fiche.id} ficheNom={nom} />
    </section>
  );
}
