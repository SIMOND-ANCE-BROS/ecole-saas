import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lireIntervenant } from "@/db/intervenants";
import { exigerRole } from "@/lib/session";
import { FormulaireIntervenant } from "../../formulaire";

export const metadata: Metadata = { title: "Modifier un intervenant" };

export default async function ModifierIntervenant({ params }: PageProps<"/intervenants/[id]/modifier">) {
  const { ecoleId } = await exigerRole("direction");
  const { id } = await params;
  const intervenant = await avecEcole(ecoleId, (tx) => lireIntervenant(tx, id));
  if (!intervenant) notFound();
  const nom = `${intervenant.prenom} ${intervenant.nom}`;
  return <section className="flex w-full min-w-0 flex-col gap-4">
    <nav aria-label="Fil d’Ariane" className="text-sm"><Link className="lien" href="/intervenants">Intervenants</Link><span> / </span><Link className="lien" href={`/intervenants/${id}`}>{nom}</Link><span className="text-doux"> / Modifier</span></nav>
    <h1 className="titre-page">Modifier {nom}</h1>
    <FormulaireIntervenant intervenant={intervenant} />
  </section>;
}
