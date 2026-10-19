import type { Metadata } from "next";
import Link from "next/link";
import { avecEcole } from "@/db";
import { lirePersonne, nomAffiche } from "@/db/personnes";
import { exigerRole } from "@/lib/session";
import { FormulairePersonne } from "../formulaire";
import { estRelation } from "../relations";

export const metadata: Metadata = { title: "Nouvelle personne" };

/** `?lien=<id>&relation=<relation>` : la personne créée sera liée à cette fiche. */
export default async function PageNouvellePersonne({ searchParams }: PageProps<"/personnes/nouvelle">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const { lien, relation } = await searchParams;
  const fiche = typeof lien === "string" ? await avecEcole(ecoleId, (tx) => lirePersonne(tx, lien)) : null;
  const lienAvec = fiche ? { ficheId: fiche.id, ficheNom: nomAffiche(fiche), relation: estRelation(relation) ? relation : "representant" } : undefined;

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        {fiche ? (
          <Link href={`/personnes/${fiche.id}`} className="lien">
            {nomAffiche(fiche)}
          </Link>
        ) : (
          <Link href="/personnes" className="lien">
            Personnes
          </Link>
        )}
        <span className="text-doux"> / Nouvelle personne</span>
      </nav>
      <h1 className="titre-page">{fiche ? `Nouvelle personne liée à ${nomAffiche(fiche)}` : "Nouvelle personne"}</h1>
      <FormulairePersonne
        personne={null}
        lienAvec={lienAvec}
        nomPropose={fiche?.type === "particulier" ? fiche.nom : undefined}
      />
    </section>
  );
}
