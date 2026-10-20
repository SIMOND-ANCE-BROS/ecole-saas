import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { etatAgenda } from "@/db/agenda";
import { STATUTS, REGIMES_TVA, MODES_REMUNERATION, lireIntervenant } from "@/db/intervenants";
import { exigerRole } from "@/lib/session";
import { formaterEuros } from "@/lib/montant";
import { AbonnementAgenda } from "./agenda";

export const metadata: Metadata = { title: "Intervenant" };

export default async function PageIntervenant({ params }: PageProps<"/intervenants/[id]">) {
  const { ecoleId } = await exigerRole("direction");
  const { id } = await params;
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const i = await lireIntervenant(tx, id);
    return i ? { intervenant: i, agenda: await etatAgenda(tx, i.id) } : null;
  });
  if (!donnees) notFound();
  const { intervenant, agenda } = donnees;

  const nom = `${intervenant.prenom} ${intervenant.nom}`;
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/intervenants" className="lien">
          Intervenants
        </Link>
        <span className="text-doux"> / {nom}</span>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="titre-page">{nom}</h1><p className="text-sm text-doux">{intervenant.actif ? "Actif" : "Inactif"}{intervenant.estDirigeant ? " · Dirigeant de l’école" : ""}</p></div>
        <Link href={`/intervenants/${id}/modifier`} className="bouton-secondaire">Modifier la fiche</Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panneau p-4" aria-labelledby="identite">
          <h2 id="identite" className="mb-3 font-semibold">Coordonnées et statut</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
            <dt className="text-doux">E-mail</dt><dd className="break-all">{intervenant.email ? <a className="lien" href={`mailto:${intervenant.email}`}>{intervenant.email}</a> : "Non renseigné"}</dd>
            <dt className="text-doux">Statut</dt><dd>{STATUTS[intervenant.statut]}</dd>
            {intervenant.statut !== "salarie" && <><dt className="text-doux">SIREN</dt><dd>{intervenant.siren || "Non renseigné"}</dd></>}
            <dt className="text-doux">TVA</dt><dd>{REGIMES_TVA[intervenant.regimeTva]}</dd>
          </dl>
        </section>
        <section className="panneau p-4" aria-labelledby="remuneration">
          <h2 id="remuneration" className="mb-3 font-semibold">Rémunération</h2>
          <p className="text-sm">{MODES_REMUNERATION[intervenant.modeRemuneration]}</p>
          <p className="mt-2 text-xl font-semibold tabular-nums">{formaterEuros(intervenant.tarifCentimes)} <span className="text-sm font-normal text-doux">/ {({ heure: "heure", cours: "cours", forfait_mensuel: "mois" })[intervenant.modeRemuneration]}</span></p>
          <p className="mt-2 text-xs text-doux">Tarif de référence. Ce montant n’est pas un relevé à payer.</p>
        </section>
      </div>
      <AbonnementAgenda intervenantId={intervenant.id} prenom={intervenant.prenom} actifDepuis={agenda?.toISOString() ?? null} />
    </section>
  );
}

