import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lireFamille } from "@/db/familles";
import { exigerRole } from "@/lib/session";
import { FormulaireFamille } from "../../formulaire";

export const metadata: Metadata = { title: "Modifier une famille" };

export default async function PageModifierFamille({ params }: PageProps<"/familles/[id]/modifier">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const { id } = await params;
  const famille = await avecEcole(ecoleId, (tx) => lireFamille(tx, id));
  if (!famille) notFound();
  const nom = famille.raisonSociale ?? [famille.nom, famille.prenom].filter(Boolean).join(" ");

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href={`/familles/${famille.id}`} className="lien">
          {nom}
        </Link>
        <span className="text-doux"> / Modifier</span>
      </nav>
      <h1 className="titre-page">Modifier {nom}</h1>
      <FormulaireFamille famille={famille} />
    </section>
  );
}
