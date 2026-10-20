import type { Metadata } from "next";
import Link from "next/link";
import { avecEcole } from "@/db";
import { saisonCourante } from "@/db/planning";
import { listerFermetures } from "@/db/seances";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";
import { GestionFermetures } from "./gestion";

export const metadata: Metadata = { title: "Fermetures" };

export default async function PageFermetures() {
  const { ecoleId } = await exigerRole("direction");
  const { saison, fermetures } = await avecEcole(ecoleId, async (tx) => {
    const s = await saisonCourante(tx, aujourdhuiAParis());
    return { saison: s, fermetures: s ? await listerFermetures(tx, s.id) : [] };
  });

  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/planning" className="lien">
          Planning
        </Link>
        <span className="text-doux"> / Fermetures</span>
      </nav>
      <div>
        <h1 className="titre-page">Fermetures {saison?.libelle}</h1>
        <p className="text-sm text-doux">
          Vacances, jours fériés, gala : aucun cours n’a lieu ces jours-là. Les séances à venir se mettent à jour aussitôt ; une
          séance dont l’appel est fait n’est jamais retirée.
        </p>
      </div>
      {saison ? (
        <GestionFermetures fermetures={fermetures} debutSaison={saison.dateDebut} finSaison={saison.dateFin} />
      ) : (
        <p className="text-sm">Aucune saison n’est paramétrée.</p>
      )}
    </section>
  );
}
