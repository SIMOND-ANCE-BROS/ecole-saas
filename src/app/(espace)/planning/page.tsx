import type { Metadata } from "next";
import { avecEcole } from "@/db";
import { coursDeLaSaison, saisonCourante } from "@/db/planning";
import { aujourdhuiAParis } from "@/domaine/familles/age";
import { contexteEcole } from "@/lib/session";
import { GrillePlanning } from "./grille";

export const metadata: Metadata = { title: "Planning" };

export default async function PagePlanning() {
  const { ecoleId } = await contexteEcole();
  const { saison, cours } = await avecEcole(ecoleId, async (tx) => {
    const s = await saisonCourante(tx, aujourdhuiAParis());
    return { saison: s, cours: s ? await coursDeLaSaison(tx, s.id) : [] };
  });

  if (!saison) {
    return <p className="text-sm text-doux">Aucune saison n’est encore paramétrée.</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="titre-page">Planning {saison.libelle}</h1>
      {cours.length === 0 ? <p className="text-sm text-doux">Aucun cours pour cette saison.</p> : <GrillePlanning cours={cours} />}
    </section>
  );
}
