import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lireEleve } from "@/db/eleves";
import { danseursPayables, nomAffiche } from "@/db/personnes";
import { coursDeLaSaison, saisonCourante } from "@/db/planning";
import { ageAu, aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";
import { FormulaireInscription } from "./formulaire";

export const metadata: Metadata = { title: "Nouvelle inscription" };

/**
 * Inscription d'un élève, facturée à son payeur (« Facturé à » de sa fiche).
 * Sa fratrie, facturée à la même personne, peut être inscrite dans la foulée.
 */
export default async function PageInscription({ params }: PageProps<"/eleves/[id]/inscription">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const { id } = await params;
  const aujourdhui = aujourdhuiAParis();
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const eleve = await lireEleve(tx, id, aujourdhui);
    if (!eleve) return null;
    const payeurId = eleve.factureA.type === "personne" ? eleve.factureA.id : eleve.factureA.type === "eleve" ? eleve.id : null;
    const saison = await saisonCourante(tx, aujourdhui);
    return {
      eleve,
      payeurId,
      saison,
      danseurs: payeurId ? await danseursPayables(tx, payeurId) : [],
      cours: saison ? await coursDeLaSaison(tx, saison.id) : [],
    };
  });
  if (!donnees) notFound();
  const { eleve, payeurId, saison, danseurs, cours } = donnees;
  const nom = nomAffiche(eleve);
  const payeur = eleve.factureA.type === "personne" ? eleve.factureA.nom : nom;

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/eleves" className="lien">
          Élèves
        </Link>
        <span className="text-doux"> / </span>
        <Link href={`/eleves/${eleve.id}`} className="lien">
          {nom}
        </Link>
        <span className="text-doux"> / Nouvelle inscription</span>
      </nav>
      <div>
        <h1 className="titre-page">Nouvelle inscription{saison && ` ${saison.libelle}`}</h1>
        {payeurId && <p className="text-sm text-doux">Facturée à {payeur}. Pour changer, modifiez « Facturé à » sur la fiche de l’élève.</p>}
      </div>
      {!saison ? (
        <p className="text-sm">Aucune saison n’est paramétrée.</p>
      ) : !payeurId ? (
        <p className="text-sm">
          {eleve.prenom ?? nom} est mineur et n’a pas de payeur.{" "}
          <Link href={`/eleves/${eleve.id}`} className="lien">
            Indiquez à qui facturer sur sa fiche
          </Link>
          .
        </p>
      ) : (
        <FormulaireInscription
          payeurId={payeurId}
          danseurs={danseurs.map((d) => ({ id: d.id, prenom: d.prenom, age: d.dateNaissance ? ageAu(d.dateNaissance, aujourdhui) : null }))}
          cours={cours}
          danseurInitial={eleve.id}
        />
      )}
    </section>
  );
}
