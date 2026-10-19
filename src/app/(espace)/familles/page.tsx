import type { Metadata } from "next";
import Link from "next/link";
import { avecEcole } from "@/db";
import { rechercherFamilles } from "@/db/familles";
import { contexteEcole } from "@/lib/session";
import { Recherche } from "./recherche";

export const metadata: Metadata = { title: "Familles" };

export default async function PageFamilles({ searchParams }: PageProps<"/familles">) {
  const { ecoleId } = await contexteEcole();
  const { q } = await searchParams;
  const saisie = typeof q === "string" ? q : "";
  const resultats = saisie ? await avecEcole(ecoleId, (tx) => rechercherFamilles(tx, saisie)) : [];

  return (
    <section className="flex flex-col gap-4">
      <h1 className="titre-page">Familles</h1>
      <Recherche valeurInitiale={saisie} />
      {saisie.trim().length >= 2 &&
        (resultats.length === 0 ? (
          <p className="text-sm">Aucune famille ne correspond à « {saisie.trim()} ».</p>
        ) : (
          <div className="panneau overflow-x-auto">
<table className="tableau">
            <caption className="sr-only">Familles correspondant à la recherche</caption>
<thead>
              <tr>
                <th scope="col">Payeur</th>
                <th scope="col">Danseurs</th>
                <th scope="col">Téléphone</th>
                <th scope="col">E-mail</th>
              </tr>
            </thead>
            <tbody>
              {resultats.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link href={`/familles/${f.id}`} className="font-medium lien">
                      {f.raisonSociale ?? [f.nom, f.prenom].filter(Boolean).join(" ")}
                    </Link>
                  </td>
                  <td>{f.danseurs.join(", ") || "—"}</td>
                  <td className="whitespace-nowrap">{f.telephone ?? "—"}</td>
                  <td>{f.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
        ))}
    </section>
  );
}
