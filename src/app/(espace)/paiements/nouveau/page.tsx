import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { estEleve } from "@/db/eleves";
import { soldeDe } from "@/db/paiements";
import { lirePersonne, nomAffiche } from "@/db/personnes";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";
import { FormulaireEncaissement } from "./formulaire";

export const metadata: Metadata = { title: "Encaisser" };

/** Encaissement pour un payeur (`?payeur=`), ouvert aussi en panneau depuis sa fiche. */
export default async function PageEncaisser({ searchParams }: PageProps<"/paiements/nouveau">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const { payeur } = await searchParams;
  const aujourdhui = aujourdhuiAParis();
  const donnees =
    typeof payeur === "string"
      ? await avecEcole(ecoleId, async (tx) => {
          const p = await lirePersonne(tx, payeur);
          return p ? { p, eleve: await estEleve(tx, p.id), solde: await soldeDe(tx, p.id, aujourdhui) } : null;
        })
      : null;
  if (!donnees) notFound();
  const { p, eleve, solde } = donnees;
  const retour = `/${eleve ? "eleves" : "contacts"}/${p.id}`;

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href={retour} className="lien">
          {nomAffiche(p)}
        </Link>
        <span className="text-doux"> / Encaisser</span>
      </nav>
      <h1 className="titre-page">Encaisser</h1>
      <FormulaireEncaissement
        payeurId={p.id}
        payeur={nomAffiche(p)}
        reste={solde?.reste ?? null}
        aujourdhui={aujourdhui}
        retour={retour}
      />
    </section>
  );
}
