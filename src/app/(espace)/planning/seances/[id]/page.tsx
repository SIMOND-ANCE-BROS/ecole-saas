import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { referentielPlanning } from "@/db/cours";
import { lireAppel } from "@/db/seances";
import { ageAu } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";
import { fin } from "../../format";
import { FicheAppel } from "./fiche";

export const metadata: Metadata = { title: "Appel" };

const dateLongue = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export default async function PageAppel({ params }: PageProps<"/planning/seances/[id]">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const { id } = await params;
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const appel = await lireAppel(tx, id);
    if (!appel) return null;
    const { intervenants } = await referentielPlanning(tx, appel.intervenantId);
    return { appel, intervenants: intervenants.map((i) => ({ id: i.id, nom: `${i.prenom} ${i.nom}` })) };
  });
  if (!donnees) notFound();
  const { appel, intervenants } = donnees;
  const date = dateLongue.format(new Date(`${appel.date}T00:00:00Z`));

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/planning" className="lien">
          Planning
        </Link>
        <span className="text-doux"> / </span>
        <Link href={`/planning/cours/${appel.coursId}`} className="lien">
          {appel.discipline}
        </Link>
        <span className="text-doux"> / Appel du {date}</span>
      </nav>
      <div>
        <h1 className="titre-page">
          Appel : {appel.discipline}
          {appel.niveau && <span className="font-normal text-doux"> {appel.niveau}</span>}
        </h1>
        <p className="text-sm first-letter:uppercase">
          {date}, {appel.heureDebut}–{fin(appel.heureDebut, appel.dureeMinutes)}, {appel.salle}
        </p>
      </div>
      <FicheAppel
        appel={{
          ...appel,
          danseurs: appel.danseurs.map((d) => ({ ...d, age: d.dateNaissance ? ageAu(d.dateNaissance, appel.date) : null })),
        }}
        intervenants={intervenants}
      />
    </section>
  );
}
