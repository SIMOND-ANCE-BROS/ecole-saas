import type { Metadata } from "next";
import Link from "next/link";
import { avecEcole } from "@/db";
import { listerIntervenants, MODES_REMUNERATION, STATUTS } from "@/db/intervenants";
import { saisonCourante } from "@/db/planning";
import { aujourdhuiAParis } from "@/domaine/familles/age";
import { formaterEuros } from "@/lib/montant";
import { exigerRole } from "@/lib/session";

export const metadata: Metadata = { title: "Intervenants" };

export default async function PageIntervenants({ searchParams }: PageProps<"/intervenants">) {
  const { ecoleId, role } = await exigerRole("direction", "accueil");
  const { enregistre } = await searchParams;
  const { saison, intervenants } = await avecEcole(ecoleId, async (tx) => {
    const s = await saisonCourante(tx, aujourdhuiAParis());
    return { saison: s, intervenants: s ? await listerIntervenants(tx, s.id) : [] };
  });
  const direction = role === "direction";
  const confirme = intervenants.find((i) => i.id === enregistre);

  return (
    <section className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titre-page">Intervenants</h1>
          <p className="text-sm text-doux">
            {intervenants.filter((i) => i.actif).length} actif{intervenants.filter((i) => i.actif).length > 1 ? "s" : ""}
            {saison && `, cours de la saison ${saison.libelle}`}
          </p>
        </div>
        {direction && (
          <Link href="/intervenants/nouveau" className="bouton-principal">
            Ajouter un intervenant
          </Link>
        )}
      </div>

      {confirme && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
          {confirme.prenom} {confirme.nom} enregistré.
        </p>
      )}

      {intervenants.length === 0 ? (
        <p className="text-sm text-doux">
          Aucun intervenant pour l’instant.{direction && " Ajoutez les professeurs avant de construire le planning."}
        </p>
      ) : (
        <div className="panneau overflow-x-auto">
          <table className="tableau">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Statut</th>
                <th className="text-right">Cours</th>
                {direction && <th className="text-right">Tarif</th>}
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {intervenants.map((i) => (
                <tr key={i.id} className={i.actif ? "" : "text-doux"}>
                  <td className="font-medium">
                    {direction ? (
                      <Link href={`/intervenants/${i.id}`} className="lien">
                        {i.prenom} {i.nom}
                      </Link>
                    ) : (
                      `${i.prenom} ${i.nom}`
                    )}
                    {!i.actif && <span className="ml-2 rounded bg-alerte-fond px-1.5 text-xs text-alerte-texte">inactif</span>}
                  </td>
                  <td>{STATUTS[i.statut]}</td>
                  <td className="text-right tabular-nums">{i.coursSaison}</td>
                  {direction && (
                    <td className="text-right whitespace-nowrap tabular-nums">
                      {formaterEuros(i.tarifCentimes)} <span className="text-doux">{MODES_REMUNERATION[i.modeRemuneration]}</span>
                    </td>
                  )}
                  <td>
                    {i.email ? (
                      <a href={`mailto:${i.email}`} className="lien">
                        {i.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
