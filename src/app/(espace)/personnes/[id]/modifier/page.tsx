import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lirePersonne, nomAffiche } from "@/db/personnes";
import { exigerRole } from "@/lib/session";
import { FormulairePersonne } from "../../formulaire";

export const metadata: Metadata = { title: "Modifier une personne" };

export default async function PageModifierPersonne({ params }: PageProps<"/personnes/[id]/modifier">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const { id } = await params;
  const fiche = await avecEcole(ecoleId, (tx) => lirePersonne(tx, id));
  if (!fiche) notFound();

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href={`/personnes/${fiche.id}`} className="lien">
          {nomAffiche(fiche)}
        </Link>
        <span className="text-doux"> / Modifier</span>
      </nav>
      <h1 className="titre-page">Modifier {nomAffiche(fiche)}</h1>
      <FormulairePersonne personne={fiche} />
    </section>
  );
}
