import type { Metadata } from "next";
import Link from "next/link";
import { avecEcole } from "@/db";
import { listerPersonnes, nomAffiche, rechercherPersonnes } from "@/db/personnes";
import { ageAu, aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";
import { ResultatsNavigables } from "./resultats";

export const metadata: Metadata = { title: "Personnes" };

export default async function PagePersonnes({ searchParams }: PageProps<"/personnes">) {
  const { ecoleId } = await exigerRole("direction", "accueil");
  const { q } = await searchParams;
  const saisie = typeof q === "string" ? q.trim() : "";
  const personnes = await avecEcole(ecoleId, (tx) => (saisie ? rechercherPersonnes(tx, saisie) : listerPersonnes(tx)));
  const aujourdhui = aujourdhuiAParis();

  return (
    <section className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titre-page">Personnes</h1>
          <p className="text-sm text-doux" aria-live="polite">
            {saisie
              ? `${personnes.length} résultat${personnes.length > 1 ? "s" : ""} pour « ${saisie} »`
              : `${personnes.length} personne${personnes.length > 1 ? "s" : ""} : danseurs, parents, payeurs.`}
            {!saisie && <span className="hidden sm:inline"> Tapez dans la recherche en haut (Ctrl K) pour filtrer.</span>}
          </p>
        </div>
        <Link href="/personnes/nouvelle" className="bouton-principal">
          Nouvelle personne
        </Link>
      </div>
      {personnes.length === 0 ? (
        <p className="text-sm">
          {saisie.length < 2
            ? "Tapez au moins deux caractères."
            : "Personne ne correspond : vérifiez l’orthographe, cherchez par téléphone ou créez-la avec « Nouvelle personne »."}
        </p>
      ) : (
        <ResultatsNavigables>
          {/* Téléphone : une carte par personne ; le tableau reste pour les écrans plus larges. */}
          <ul className="panneau divide-y divide-bordure sm:hidden">
            {personnes.map((p) => (
              <li key={p.id} className="flex flex-col gap-0.5 px-3 py-2.5 text-sm">
                <span className="flex items-baseline justify-between gap-2">
                  <Link href={`/personnes/${p.id}`} className="lien text-base font-medium">
                    {nomAffiche(p)}
                  </Link>
                  {p.dateNaissance && <span className="shrink-0 text-doux tabular-nums">{ageAu(p.dateNaissance, aujourdhui)} ans</span>}
                </span>
                {p.telephone && (
                  <a href={`tel:${p.telephone.replace(/\s/g, "")}`} className="lien self-start py-1 tabular-nums">
                    {p.telephone}
                  </a>
                )}
                {p.liees.length > 0 && <span className="text-doux">Liée à {p.liees.join(", ")}</span>}
              </li>
            ))}
          </ul>
          <div className="panneau hidden overflow-x-auto sm:block">
            <table className="tableau">
              <caption className="sr-only">Personnes</caption>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th className="text-right">Âge</th>
                  <th>Liée à</th>
                  <th>Téléphone</th>
                  <th>E-mail</th>
                </tr>
              </thead>
              <tbody>
                {personnes.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/personnes/${p.id}`} data-resultat className="lien font-medium">
                        {nomAffiche(p)}
                      </Link>
                    </td>
                    <td className="text-right tabular-nums">{p.dateNaissance ? ageAu(p.dateNaissance, aujourdhui) : ""}</td>
                    <td className="text-doux">{p.liees.join(", ") || "—"}</td>
                    <td className="whitespace-nowrap tabular-nums">{p.telephone ?? "—"}</td>
                    <td>{p.email ?? "—"}</td>
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
