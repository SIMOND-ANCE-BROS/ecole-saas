import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lireFamille } from "@/db/familles";
import { exigerRole } from "@/lib/session";
import { FormulaireDanseur } from "../../../../danseurs/formulaire";

export const metadata: Metadata = { title: "Nouveau danseur" };

export default async function PageNouveauDanseur({ params }: PageProps<"/familles/[id]/danseurs/nouveau">) {
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
        <span className="text-doux"> / Nouveau danseur</span>
      </nav>
      <h1 className="titre-page">Nouveau danseur</h1>
      <FormulaireDanseur
        cible={{ payeurId: famille.id }}
        danseur={null}
        nomPropose={famille.type === "particulier" ? famille.nom : undefined}
        retour={`/familles/${famille.id}`}
      />
    </section>
  );
}
