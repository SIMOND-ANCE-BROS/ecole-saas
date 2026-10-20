import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lireCours, referentielPlanning } from "@/db/cours";
import { coursDeLaSaison } from "@/db/planning";
import { exigerRole } from "@/lib/session";
import { FormulaireCours } from "../../formulaire";

export const metadata: Metadata = { title: "Modifier un cours" };

export default async function PageModifierCours({ params }: PageProps<"/planning/cours/[id]/modifier">) {
  const { ecoleId } = await exigerRole("direction");
  const { id } = await params;
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const cours = await lireCours(tx, id);
    if (!cours) return null;
    return {
      cours,
      referentiel: await referentielPlanning(tx, cours.intervenantId),
      planning: await coursDeLaSaison(tx, cours.saisonId),
    };
  });
  if (!donnees) notFound();
  const { cours } = donnees;

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/planning" className="lien">
          Planning
        </Link>
        <span className="text-doux"> / {cours.discipline}</span>
      </nav>
      <h1 className="titre-page">Modifier le cours : {cours.discipline}</h1>
      <FormulaireCours cours={cours} referentiel={donnees.referentiel} planning={donnees.planning} />
    </section>
  );
}
