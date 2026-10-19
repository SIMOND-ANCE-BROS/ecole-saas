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
        <Link href="/familles" className="underline-offset-2 hover:underline">
          ← Familles
        </Link>
      </p>
      <h1 className="text-xl font-semibold">{nom}</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-neutral-600 dark:text-neutral-400">Type</dt>
        <dd>{famille.type === "professionnel" ? "Professionnel (entreprise, CSE…)" : "Particulier"}</dd>
        <dt className="text-neutral-600 dark:text-neutral-400">Téléphone</dt>
        <dd>{famille.telephone ?? "—"}</dd>
        <dt className="text-neutral-600 dark:text-neutral-400">E-mail</dt>
        <dd>{famille.email ?? "—"}</dd>
        <dt className="text-neutral-600 dark:text-neutral-400">Adresse</dt>
        <dd>{famille.adresse ?? "—"}</dd>
      </dl>
      <h2 className="text-base font-semibold">Danseurs</h2>
      {famille.danseurs.length === 0 ? (
        <p className="text-sm">Aucun danseur rattaché.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-300 text-xs uppercase text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
            <tr>
              <th scope="col" className="py-1 pr-4 font-medium">Prénom</th>
              <th scope="col" className="py-1 pr-4 font-medium">Nom</th>
              <th scope="col" className="py-1 font-medium">Âge</th>
            </tr>
          </thead>
          <tbody>
            {famille.danseurs.map((d) => (
              <tr key={d.id} className="border-b border-neutral-200 dark:border-neutral-800">
                <td className="py-1 pr-4">{d.prenom}</td>
                <td className="py-1 pr-4">{d.nom}</td>
                <td className="py-1">{d.dateNaissance ? `${ageAu(d.dateNaissance, aujourdhui)} ans` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-300 text-xs uppercase text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
            <tr>
              <th scope="col" className="py-1 pr-4 font-medium">Danseur</th>
              <th scope="col" className="py-1 pr-4 font-medium">Cours</th>
              <th scope="col" className="py-1 pr-4 font-medium">Formule</th>
              <th scope="col" className="py-1 text-right font-medium">Prix</th>
            </tr>
          </thead>
          <tbody>
            {inscriptions.map((i) => (
              <tr key={i.id} className="border-b border-neutral-200 dark:border-neutral-800">
                <td className="py-1 pr-4">{i.danseurs}</td>
                <td className="py-1 pr-4">{i.cours.join(", ")}</td>
                <td className="py-1 pr-4">
                  {i.public}, {PERIODICITE[i.periodicite]}
                </td>
                <td className="py-1 text-right tabular-nums">{formaterEuros(i.prixNetCentimes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
