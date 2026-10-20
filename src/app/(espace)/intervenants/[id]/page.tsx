import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lireIntervenant } from "@/db/intervenants";
import { exigerRole } from "@/lib/session";
import { FormulaireIntervenant } from "../formulaire";

export const metadata: Metadata = { title: "Intervenant" };

export default async function PageIntervenant({ params }: PageProps<"/intervenants/[id]">) {
  const { ecoleId } = await exigerRole("direction");
  const { id } = await params;
  const intervenant = await avecEcole(ecoleId, (tx) => lireIntervenant(tx, id));
  if (!intervenant) notFound();

  const nom = `${intervenant.prenom} ${intervenant.nom}`;
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/intervenants" className="lien">
          Intervenants
        </Link>
        <span className="text-doux"> / {nom}</span>
      </nav>
      <h1 className="titre-page">{nom}</h1>
      <FormulaireIntervenant intervenant={intervenant} />
    </section>
  );
}
