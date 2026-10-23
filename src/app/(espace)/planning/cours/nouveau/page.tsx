import type { Metadata } from "next";
import Link from "next/link";
import { avecEcole } from "@/db";
import { referentielPlanning } from "@/db/cours";
import { coursDeLaSaison, saisonCourante } from "@/db/planning";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { dateValide } from "@/domaine/planning/semaine";
import { exigerRole } from "@/lib/session";
import { FormulaireCours } from "../formulaire";

export const metadata: Metadata = { title: "Nouveau cours" };

export default async function PageNouveauCours({ searchParams }: PageProps<"/planning/cours/nouveau">) {
  const { ecoleId } = await exigerRole("direction");
  const { jour, heure, duree, date } = await searchParams;
  const { saison, referentiel, planning } = await avecEcole(ecoleId, async (tx) => {
    const s = await saisonCourante(tx, aujourdhuiAParis());
    return {
      saison: s,
      referentiel: await referentielPlanning(tx),
      planning: s ? await coursDeLaSaison(tx, s.id) : [],
    };
  });
  if (!saison) return <p className="text-sm text-doux">Aucune saison n’est encore paramétrée.</p>;
  const jourPropose = Number(jour);
  const dureeProposee = Number(duree);

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/planning" className="lien">
          Planning {saison.libelle}
        </Link>
        <span className="text-doux"> / Nouveau cours</span>
      </nav>
      <h1 className="titre-page">Nouveau cours</h1>
      <FormulaireCours
        cours={null}
        referentiel={referentiel}
        planning={planning}
        jour={Number.isInteger(jourPropose) && jourPropose >= 1 && jourPropose <= 7 ? jourPropose : undefined}
        heure={typeof heure === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(heure) ? heure : undefined}
        date={dateValide(date) ?? undefined}
        duree={
          Number.isInteger(dureeProposee) && dureeProposee >= 5 && dureeProposee <= 600 ? dureeProposee : undefined
        }
      />
    </section>
  );
}
