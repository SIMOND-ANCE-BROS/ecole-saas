import type { Metadata } from "next";
import Link from "next/link";
import { avecEcole } from "@/db";
import { listerDisciplines, listerSaisons } from "@/db/parametres";
import { saisonCourante } from "@/db/planning";
import { grilleSaison, lireFratrie, listerCarnets } from "@/db/tarifs";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";
import { EnteteParametres } from "../entete";
import { Carnets, Fratrie, Grille } from "./tarifs";

export const metadata: Metadata = { title: "Tarifs et réductions" };

/** `?saison=<id>` : la saison affichée, par défaut la saison courante. */
export default async function PageTarifs({ searchParams }: PageProps<"/parametres/tarifs">) {
  const { ecoleId } = await exigerRole("direction");
  const { saison: choisie } = await searchParams;
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const saisons = await listerSaisons(tx);
    const courante = await saisonCourante(tx, aujourdhuiAParis());
    const saison = saisons.find((s) => s.id === choisie) ?? saisons.find((s) => s.id === courante?.id) ?? saisons[0];
    if (!saison) return null;
    return {
      saisons,
      saison,
      grille: await grilleSaison(tx, saison.id),
      disciplines: (await listerDisciplines(tx)).map((d) => ({ id: d.id, nom: d.nom })),
      fratrie: await lireFratrie(tx, saison.id),
      carnets: await listerCarnets(tx, saison.id),
    };
  });

  return (
    <section className="flex w-full min-w-0 flex-col gap-5">
      <EnteteParametres
        titre="Tarifs et réductions"
        aide="Le prix d’une inscription dépend de la durée hebdomadaire cumulée des cours choisis : une ligne par combinaison (« 45 min + 1 h »), éventuellement réservée à une discipline. Les inscriptions déjà faites gardent leur prix."
      />
      {!donnees ? (
        <p className="text-sm">
          Créez d’abord une{" "}
          <Link href="/parametres/saisons" className="lien">
            saison
          </Link>
          .
        </p>
      ) : (
        <>
          <nav aria-label="Saisons" className="flex flex-wrap gap-2 text-sm">
            {donnees.saisons.map((s) => (
              <Link
                key={s.id}
                href={`/parametres/tarifs?saison=${s.id}`}
                aria-current={s.id === donnees.saison.id ? "page" : undefined}
                className="rounded-md border border-bordure px-3 py-1 hover:border-accent aria-[current=page]:border-accent aria-[current=page]:bg-accent-doux aria-[current=page]:font-medium"
              >
                {s.libelle}
              </Link>
            ))}
          </nav>
          <Grille saisonId={donnees.saison.id} grille={donnees.grille} disciplines={donnees.disciplines} />
          <div className="grid gap-5 lg:grid-cols-2">
            <Fratrie saisonId={donnees.saison.id} fratrie={donnees.fratrie} />
            <Carnets saisonId={donnees.saison.id} carnets={donnees.carnets} />
          </div>
        </>
      )}
    </section>
  );
}
