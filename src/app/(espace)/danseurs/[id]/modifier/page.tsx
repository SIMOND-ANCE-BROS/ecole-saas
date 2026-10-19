import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lireDanseur } from "@/db/danseurs";
import { exigerRole } from "@/lib/session";
import { FormulaireDanseur } from "../../formulaire";

export const metadata: Metadata = { title: "Modifier un danseur" };

export default async function PageModifierDanseur({ params }: PageProps<"/danseurs/[id]/modifier">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const { id } = await params;
  const danseur = await avecEcole(ecoleId, (tx) => lireDanseur(tx, id));
  if (!danseur) notFound();
  const nom = `${danseur.prenom} ${danseur.nom}`;

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href={`/familles/${danseur.famille.id}`} className="lien">
          {danseur.famille.nom}
        </Link>
        <span className="text-doux"> / </span>
        <Link href={`/danseurs/${danseur.id}`} className="lien">
          {nom}
        </Link>
        <span className="text-doux"> / Modifier</span>
      </nav>
      <h1 className="titre-page">Modifier {nom}</h1>
      <FormulaireDanseur cible={{ id: danseur.id }} danseur={danseur} retour={`/danseurs/${danseur.id}`} />
    </section>
  );
}
