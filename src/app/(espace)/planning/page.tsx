import type { Metadata } from "next";
import Link from "next/link";
import { avecEcole } from "@/db";
import { coursDeLaSaison, saisonCourante } from "@/db/planning";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { contexteEcole } from "@/lib/session";
import { GrillePlanning } from "./grille";

export const metadata: Metadata = { title: "Planning" };

export default async function PagePlanning({ searchParams }: PageProps<"/planning">) {
  const { ecoleId, role } = await contexteEcole();
  const { enregistre, supprime } = await searchParams;
  const { saison, cours } = await avecEcole(ecoleId, async (tx) => {
    const s = await saisonCourante(tx, aujourdhuiAParis());
    return { saison: s, cours: s ? await coursDeLaSaison(tx, s.id) : [] };
  });

  if (!saison) {
    return <p className="text-sm text-doux">Aucune saison n’est encore paramétrée.</p>;
  }
  const direction = role === "direction";
  const enregistreId = typeof enregistre === "string" ? enregistre : undefined;
  const confirme = cours.find((c) => c.id === enregistreId);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="titre-page">Planning {saison.libelle}</h1>
        {direction && (
          <div className="flex gap-2">
            <Link href="/planning/fermetures" className="bouton-secondaire">
              Fermetures
            </Link>
            <Link href="/planning/cours/nouveau" className="bouton-principal">
              Nouveau cours
            </Link>
          </div>
        )}
      </div>
      {confirme && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
          Cours de {confirme.discipline} enregistré.
        </p>
      )}
      {supprime && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
          Cours supprimé.
        </p>
      )}
      {cours.length === 0 ? (
        <p className="text-sm text-doux">
          Aucun cours pour cette saison.{direction && " Créez le premier avec « Nouveau cours »."}
        </p>
      ) : (
        <GrillePlanning cours={cours} modifiable={direction} misEnAvant={confirme?.id} />
      )}
    </section>
  );
}
