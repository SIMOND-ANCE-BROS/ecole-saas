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
      <h1 className="text-xl font-semibold">Familles</h1>
      <Recherche valeurInitiale={saisie} />
      {saisie.trim().length >= 2 &&
        (resultats.length === 0 ? (
          <p className="text-sm">Aucune famille ne correspond à « {saisie.trim()} ».</p>
        ) : (
          <table className="w-full max-w-5xl text-left text-sm">
            <caption className="sr-only">Familles correspondant à la recherche</caption>
            <thead className="border-b border-neutral-300 text-xs uppercase text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
              <tr>
                <th scope="col" className="py-1 pr-4 font-medium">Payeur</th>
                <th scope="col" className="py-1 pr-4 font-medium">Danseurs</th>
                <th scope="col" className="py-1 pr-4 font-medium">Téléphone</th>
                <th scope="col" className="py-1 font-medium">E-mail</th>
              </tr>
            </thead>
            <tbody>
              {resultats.map((f) => (
                <tr key={f.id} className="border-b border-neutral-200 dark:border-neutral-800">
                  <td className="py-1 pr-4">
                    <Link href={`/familles/${f.id}`} className="font-medium text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
                      {f.raisonSociale ?? [f.nom, f.prenom].filter(Boolean).join(" ")}
                    </Link>
                  </td>
                  <td className="py-1 pr-4">{f.danseurs.join(", ") || "—"}</td>
                  <td className="py-1 pr-4 whitespace-nowrap">{f.telephone ?? "—"}</td>
                  <td className="py-1">{f.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </section>
  );
}
