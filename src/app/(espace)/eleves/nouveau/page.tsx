import type { Metadata } from "next";
import Link from "next/link";
import { avecEcole } from "@/db";
import { lirePersonne, nomAffiche } from "@/db/personnes";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";
import { GuideNouvelEleve } from "./guide";

export const metadata: Metadata = { title: "Nouvel élève" };

/** `?responsable=<id>` : depuis la fiche d'un contact (« Ajouter un enfant »), le responsable est déjà choisi. */
export default async function PageNouvelEleve({ searchParams }: PageProps<"/eleves/nouveau">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const { responsable } = await searchParams;
  const r = typeof responsable === "string" ? await avecEcole(ecoleId, (tx) => lirePersonne(tx, responsable)) : null;
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/eleves" className="lien">
          Élèves
        </Link>
        <span className="text-doux"> / Nouvel élève</span>
      </nav>
      <h1 className="titre-page">Nouvel élève</h1>
      <GuideNouvelEleve
        aujourdhui={aujourdhuiAParis()}
        responsableInitial={r ? { id: r.id, nom: nomAffiche(r) } : undefined}
      />
    </section>
  );
}
