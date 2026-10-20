import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { referentielPlanning } from "@/db/cours";
import { disponibilitesSeance } from "@/db/disponibilites";
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
    const dispo = await disponibilitesSeance(tx, appel.id);
    const classement = new Map(dispo?.remplacants.map((r, rang) => [r.id, { ...r, rang }]));
    // Intervenant de la séance d'abord, puis remplaçants libres, puis les autres avec leur motif.
    const options = intervenants
      .map((i) => {
        const r = classement.get(i.id);
        const etat = i.id === appel.intervenantId ? "" : r?.libre ? " (libre)" : r?.motif ? ` (${r.motif})` : "";
        return { id: i.id, nom: `${i.prenom} ${i.nom}${etat}`, rang: i.id === appel.intervenantId ? -1 : (r?.rang ?? 999) };
      })
      .sort((a, b) => a.rang - b.rang)
      .map((o) => ({ id: o.id, nom: o.nom }));
    return { appel, intervenants: options, indisponible: dispo?.indisponible ?? false, libres: dispo?.remplacants.filter((r) => r.libre).length ?? 0 };
  });
  if (!donnees) notFound();
  const { appel, intervenants, indisponible, libres } = donnees;
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
      {indisponible && appel.statut !== "annulee" && (
        <p role="alert" className="rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">
          L’intervenant de cette séance est indisponible.{" "}
          {libres > 0 ? `${libres} remplaçant${libres > 1 ? "s" : ""} libre${libres > 1 ? "s" : ""} en tête de la liste « Intervenant de la séance ».` : "Aucun autre intervenant n’est libre à cette heure."}
        </p>
      )}
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
