import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { danseursPayables, lirePersonne, nomAffiche } from "@/db/personnes";
import { coursDeLaSaison, saisonCourante } from "@/db/planning";
import { ageAu, aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";
import { FormulaireInscription } from "./formulaire";

export const metadata: Metadata = { title: "Nouvelle inscription" };

/** Inscription payée par la personne [id] : elle-même, ou ceux pour qui elle paie. */
export default async function PageInscription({ params, searchParams }: PageProps<"/personnes/[id]/inscription">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const [{ id }, { danseur }] = await Promise.all([params, searchParams]);
  const aujourdhui = aujourdhuiAParis();
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const payeur = await lirePersonne(tx, id);
    if (!payeur) return null;
    const saison = await saisonCourante(tx, aujourdhui);
    return { payeur, saison, danseurs: await danseursPayables(tx, payeur.id), cours: saison ? await coursDeLaSaison(tx, saison.id) : [] };
  });
  if (!donnees) notFound();
  const { payeur, saison, danseurs, cours } = donnees;
  const nom = nomAffiche(payeur);

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href={`/personnes/${payeur.id}`} className="lien">
          {nom}
        </Link>
        <span className="text-doux"> / Nouvelle inscription</span>
      </nav>
      <div>
        <h1 className="titre-page">Nouvelle inscription{saison && ` ${saison.libelle}`}</h1>
        <p className="text-sm text-doux">Payée par {nom}</p>
      </div>
      {!saison ? (
        <p className="text-sm">Aucune saison n’est paramétrée.</p>
      ) : danseurs.length === 0 ? (
        <p className="text-sm">
          {nom} ne paie pour personne.{" "}
          <Link href={`/personnes/${payeur.id}/liens/nouveau`} className="lien">
            Ajoutez un lien
          </Link>{" "}
          vers le danseur et cochez « paie ses cours ».
        </p>
      ) : (
        <FormulaireInscription
          payeurId={payeur.id}
          danseurs={danseurs.map((d) => ({ id: d.id, prenom: d.prenom, age: d.dateNaissance ? ageAu(d.dateNaissance, aujourdhui) : null }))}
          cours={cours}
          danseurInitial={typeof danseur === "string" ? danseur : undefined}
        />
      )}
    </section>
  );
}
