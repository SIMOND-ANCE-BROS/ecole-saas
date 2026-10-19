import type { Metadata } from "next";
import Link from "next/link";
import { avecEcole } from "@/db";
import { listerFamilles, rechercherFamilles } from "@/db/familles";
import { contexteEcole } from "@/lib/session";
import { ResultatsNavigables } from "./resultats";

export const metadata: Metadata = { title: "Familles" };

export default async function PageFamilles({ searchParams }: PageProps<"/familles">) {
  const { ecoleId, role } = await contexteEcole();
  const { q } = await searchParams;
  const saisie = typeof q === "string" ? q.trim() : "";
  const familles = await avecEcole(ecoleId, (tx) => (saisie ? rechercherFamilles(tx, saisie) : listerFamilles(tx)));

  return (
    <section className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titre-page">Familles</h1>
          <p className="text-sm text-doux" aria-live="polite">
            {saisie
              ? `${familles.length} résultat${familles.length > 1 ? "s" : ""} pour « ${saisie} »`
              : `${familles.length} famille${familles.length > 1 ? "s" : ""}, tapez dans la recherche en haut (Ctrl K) pour filtrer`}
          </p>
        </div>
        {role !== "professeur" && (
          <Link href="/familles/nouvelle" className="bouton-principal">
            Nouvelle famille
          </Link>
        )}
      </div>
      {familles.length === 0 ? (
        <p className="text-sm">
          {saisie.length < 2 ? "Tapez au moins deux caractères." : "Aucune famille ne correspond : vérifiez l’orthographe, cherchez par téléphone ou créez-la avec « Nouvelle famille »."}
        </p>
      ) : (
        <ResultatsNavigables>
          <div className="panneau overflow-x-auto">
            <table className="tableau">
              <caption className="sr-only">Familles</caption>
              <thead>
                <tr>
                  <th>Payeur</th>
                  <th>Danseurs</th>
                  <th>Téléphone</th>
                  <th>E-mail</th>
                </tr>
              </thead>
              <tbody>
                {familles.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <Link href={`/familles/${f.id}`} data-resultat className="lien font-medium">
                        {f.raisonSociale ?? [f.nom, f.prenom].filter(Boolean).join(" ")}
                      </Link>
                    </td>
                    <td>{f.danseurs.join(", ") || "—"}</td>
                    <td className="whitespace-nowrap tabular-nums">{f.telephone ?? "—"}</td>
                    <td>{f.email ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ResultatsNavigables>
      )}
    </section>
  );
}
