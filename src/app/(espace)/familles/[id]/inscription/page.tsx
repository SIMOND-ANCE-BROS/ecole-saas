import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lireFamille } from "@/db/familles";
import { coursDeLaSaison, saisonCourante } from "@/db/planning";
import { ageAu, aujourdhuiAParis } from "@/domaine/familles/age";
import { exigerRole } from "@/lib/session";
import { FormulaireInscription } from "./formulaire";

export const metadata: Metadata = { title: "Nouvelle inscription" };

export default async function PageInscription({ params }: PageProps<"/familles/[id]/inscription">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const { id } = await params;
  const aujourdhui = aujourdhuiAParis();
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const famille = await lireFamille(tx, id);
    const saison = await saisonCourante(tx, aujourdhui);
    return { famille, saison, cours: saison ? await coursDeLaSaison(tx, saison.id) : [] };
  });
  if (!donnees.famille) notFound();
  const { famille, saison, cours } = donnees;
  const nom = famille.raisonSociale ?? [famille.nom, famille.prenom].filter(Boolean).join(" ");

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm">
        <Link href={`/familles/${famille.id}`} className="underline-offset-2 hover:underline">
          ← {nom}
        </Link>
      </p>
      <h1 className="text-xl font-semibold">
        Nouvelle inscription {saison ? `· ${saison.libelle}` : ""}
      </h1>
      {!saison ? (
        <p className="text-sm">Aucune saison n’est paramétrée.</p>
      ) : famille.danseurs.length === 0 ? (
        <p className="text-sm">Ajoutez d’abord un danseur à cette famille.</p>
      ) : (
        <FormulaireInscription
          payeurId={famille.id}
          danseurs={famille.danseurs.map((d) => ({
            id: d.id,
            prenom: d.prenom,
            age: d.dateNaissance ? ageAu(d.dateNaissance, aujourdhui) : null,
          }))}
          cours={cours}
        />
      )}
    </section>
  );
}
