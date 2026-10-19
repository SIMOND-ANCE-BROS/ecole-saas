import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { lireFamille } from "@/db/familles";
import { inscriptionsDeLaFamille } from "@/db/inscriptions";
import { saisonCourante } from "@/db/planning";
import { ageAu, aujourdhuiAParis } from "@/domaine/familles/age";
import { formaterEuros } from "@/lib/montant";
import { contexteEcole } from "@/lib/session";

const PERIODICITE = { trimestre: "trimestre", annee: "année", unite: "unité" } as const;

export const metadata: Metadata = { title: "Fiche famille" };

export default async function PageFamille({ params }: PageProps<"/familles/[id]">) {
  const { ecoleId, role } = await contexteEcole();
  const { id } = await params;
  const aujourdhui = aujourdhuiAParis();
  const { famille, saison, inscriptions } = await avecEcole(ecoleId, async (tx) => {
    const f = await lireFamille(tx, id);
    const s = f ? await saisonCourante(tx, aujourdhui) : null;
    return { famille: f, saison: s, inscriptions: f && s ? await inscriptionsDeLaFamille(tx, f.id, s.id) : [] };
  });
  if (!famille) notFound();

  const nom = famille.raisonSociale ?? [famille.nom, famille.prenom].filter(Boolean).join(" ");

  return (
    <article className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm">
        <Link href="/familles" className="lien">
          ← Familles
        </Link>
      </p>
      <h1 className="titre-page">{nom}</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-doux">Type</dt>
        <dd>{famille.type === "professionnel" ? "Professionnel (entreprise, CSE…)" : "Particulier"}</dd>
        <dt className="text-doux">Téléphone</dt>
        <dd>{famille.telephone ?? "—"}</dd>
        <dt className="text-doux">E-mail</dt>
        <dd>{famille.email ?? "—"}</dd>
        <dt className="text-doux">Adresse</dt>
        <dd>{famille.adresse ?? "—"}</dd>
      </dl>
      <h2 className="text-base font-semibold">Danseurs</h2>
      {famille.danseurs.length === 0 ? (
        <p className="text-sm">Aucun danseur rattaché.</p>
      ) : (
        <div className="panneau overflow-x-auto">
<table className="tableau">
<thead>
            <tr>
              <th scope="col">Prénom</th>
              <th scope="col">Nom</th>
              <th scope="col">Âge</th>
            </tr>
          </thead>
          <tbody>
            {famille.danseurs.map((d) => (
              <tr key={d.id}>
                <td>{d.prenom}</td>
                <td>{d.nom}</td>
                <td>{d.dateNaissance ? `${ageAu(d.dateNaissance, aujourdhui)} ans` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
</div>
      )}
      <div className="flex items-center gap-4">
        <h2 className="text-base font-semibold">Inscriptions {saison?.libelle}</h2>
        {saison && famille.danseurs.length > 0 && role !== "professeur" && (
          <Link href={`/familles/${famille.id}/inscription`} className="bouton-principal">
            Nouvelle inscription
          </Link>
        )}
      </div>
      {inscriptions.length === 0 ? (
        <p className="text-sm">Aucune inscription pour cette saison.</p>
      ) : (
        <div className="panneau overflow-x-auto">
<table className="tableau">
<thead>
            <tr>
              <th scope="col">Danseur</th>
              <th scope="col">Cours</th>
              <th scope="col">Formule</th>
              <th scope="col" className="py-1 text-right font-medium">Prix</th>
            </tr>
          </thead>
          <tbody>
            {inscriptions.map((i) => (
              <tr key={i.id}>
                <td>{i.danseurs}</td>
                <td>{i.cours.join(", ")}</td>
                <td>
                  {i.public}, {PERIODICITE[i.periodicite]}
                </td>
                <td className="text-right tabular-nums">{formaterEuros(i.prixNetCentimes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
</div>
      )}
    </article>
  );
}
