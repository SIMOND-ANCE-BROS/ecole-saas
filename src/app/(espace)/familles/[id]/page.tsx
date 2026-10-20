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
const PUBLIC = { enfant: "Enfant", adulte: "Adulte", couple: "Couple", etudiant: "Étudiant" } as const;

export const metadata: Metadata = { title: "Fiche famille" };

export default async function PageFamille({ params, searchParams }: PageProps<"/familles/[id]">) {
  const { ecoleId, role } = await contexteEcole();
  const [{ id }, { inscription: confirmation }] = await Promise.all([params, searchParams]);
  const aujourdhui = aujourdhuiAParis();
  const { famille, saison, inscriptions } = await avecEcole(ecoleId, async (tx) => {
    const f = await lireFamille(tx, id);
    const s = f ? await saisonCourante(tx, aujourdhui) : null;
    return { famille: f, saison: s, inscriptions: f && s ? await inscriptionsDeLaFamille(tx, f.id, s.id) : [] };
  });
  if (!famille) notFound();

  const nom = famille.raisonSociale ?? [famille.nom, famille.prenom].filter(Boolean).join(" ");
  const total = inscriptions.reduce((s, i) => s + i.prixNetCentimes, 0);
  const peutInscrire = Boolean(saison) && famille.danseurs.length > 0 && role !== "professeur";
  const inscritsCetteSaison = new Set(inscriptions.flatMap((i) => i.danseurs.split(" et ")));

  return (
    <article className="flex max-w-4xl flex-col gap-5">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/familles" className="lien">
          Familles
        </Link>
        <span className="text-doux"> / {nom}</span>
      </nav>

      {confirmation === "enregistree" && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
          Inscription enregistrée.
        </p>
      )}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titre-page">{nom}</h1>
          <p className="text-sm text-doux">
            {famille.type === "professionnel" ? "Payeur professionnel (entreprise, CSE…)" : "Particulier"}
          </p>
        </div>
        {peutInscrire && (
          <Link href={`/familles/${famille.id}/inscription`} className="bouton-principal">
            Nouvelle inscription
          </Link>
        )}
      </header>

      <dl className="panneau grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 p-4 text-sm">
        <dt className="text-doux">Téléphone</dt>
        <dd>
          {famille.telephone ? (
            <a href={`tel:${famille.telephone.replace(/\s/g, "")}`} className="lien tabular-nums">
              {famille.telephone}
            </a>
          ) : (
            "—"
          )}
        </dd>
        <dt className="text-doux">E-mail</dt>
        <dd>
          {famille.email ? (
            <a href={`mailto:${famille.email}`} className="lien">
              {famille.email}
            </a>
          ) : (
            "—"
          )}
        </dd>
        <dt className="text-doux">Adresse</dt>
        <dd>{famille.adresse ?? "—"}</dd>
      </dl>

      <section aria-labelledby="danseurs" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="danseurs" className="text-base font-semibold">
            Danseurs
          </h2>
          {role !== "professeur" && (
            <Link href={`/familles/${famille.id}/danseurs/nouveau`} className="lien text-sm">
              Ajouter un danseur
            </Link>
          )}
        </div>
        {famille.danseurs.length === 0 ? (
          <p className="text-sm text-doux">Aucun danseur rattaché à cette famille.</p>
        ) : (
          <div className="panneau overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">Prénom</th>
                  <th scope="col">Nom</th>
                  <th scope="col">Âge</th>
                  <th scope="col">Saison {saison?.libelle}</th>
                </tr>
              </thead>
              <tbody>
                {famille.danseurs.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium">
                      <Link href={`/danseurs/${d.id}`} className="lien">
                        {d.prenom}
                      </Link>
                    </td>
                    <td>{d.nom}</td>
                    <td className="tabular-nums">{d.dateNaissance ? `${ageAu(d.dateNaissance, aujourdhui)} ans` : "—"}</td>
                    <td className={inscritsCetteSaison.has(d.prenom) ? "" : "text-doux"}>
                      {inscritsCetteSaison.has(d.prenom) ? "Inscrit" : "Pas encore inscrit"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="inscriptions" className="flex flex-col gap-2">
        <h2 id="inscriptions" className="text-base font-semibold">
          Inscriptions {saison?.libelle}
        </h2>
        {inscriptions.length === 0 ? (
          <p className="text-sm text-doux">
            Aucune inscription pour cette saison.{peutInscrire && " Utilisez « Nouvelle inscription » pour en créer une."}
          </p>
        ) : (
          <div className="panneau overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">Danseur</th>
                  <th scope="col">Cours</th>
                  <th scope="col">Formule</th>
                  <th scope="col" className="text-right">
                    Prix
                  </th>
                </tr>
              </thead>
              <tbody>
                {inscriptions.map((i) => (
                  <tr key={i.id}>
                    <td className="font-medium">{i.danseurs}</td>
                    <td>{i.cours.join(", ")}</td>
                    <td>
                      {PUBLIC[i.public]}, {PERIODICITE[i.periodicite]}
                    </td>
                    <td className="text-right tabular-nums">{formaterEuros(i.prixNetCentimes)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right font-medium">
                    Total de la saison
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formaterEuros(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </article>
  );
}
