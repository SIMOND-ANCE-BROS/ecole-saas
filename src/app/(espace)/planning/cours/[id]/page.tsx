import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { coursDuPlanning, inscritsDuCours } from "@/db/planning";
import { ageAu, aujourdhuiAParis } from "@/domaine/familles/age";
import { exigerRole } from "@/lib/session";
import { ages, fin, JOURS } from "../../format";
import { BoutonImprimer } from "./imprimer";

export const metadata: Metadata = { title: "Cours" };

const STATUT = {
  active: null,
  essai: { libelle: "à l’essai", classe: "bg-accent-doux text-texte" },
  liste_attente: { libelle: "en attente", classe: "bg-alerte-fond text-alerte-texte" },
} as const;

const dateCourte = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function PageCours({ params, searchParams }: PageProps<"/planning/cours/[id]">) {
  const { ecoleId, role } = await exigerRole("direction", "accueil");
  const [{ id }, { modifie }] = await Promise.all([params, searchParams]);
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const cours = await coursDuPlanning(tx, id);
    return cours ? { cours, inscrits: await inscritsDuCours(tx, cours.id) } : null;
  });
  if (!donnees) notFound();
  const { cours, inscrits } = donnees;
  const aujourdhui = aujourdhuiAParis();

  const actifs = inscrits.filter((i) => i.statut === "active").length;
  const essais = inscrits.filter((i) => i.statut === "essai").length;
  const attente = inscrits.filter((i) => i.statut === "liste_attente").length;
  const complet = cours.capaciteMax !== null && actifs >= cours.capaciteMax;
  const creneau = cours.jourSemaine
    ? `${JOURS[cours.jourSemaine]} ${cours.heureDebut}–${fin(cours.heureDebut, cours.dureeMinutes)}`
    : `Stage, ${cours.heureDebut}–${fin(cours.heureDebut, cours.dureeMinutes)}`;
  const public_ = [ages(cours.ageMin, cours.ageMax), cours.niveau].filter(Boolean).join(", ");

  return (
    <article className="flex max-w-5xl flex-col gap-5">
      <nav aria-label="Fil d’Ariane" className="text-sm print:hidden">
        <Link href="/planning" className="lien">
          Planning
        </Link>
        <span className="text-doux"> / {cours.discipline}</span>
      </nav>

      {modifie && (
        <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm print:hidden">
          Cours modifié.
        </p>
      )}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titre-page">
            {cours.discipline}
            {cours.niveau && <span className="font-normal text-doux"> {cours.niveau}</span>}
          </h1>
          <p className="text-sm">{creneau}</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <BoutonImprimer />
          {role === "direction" && (
            <Link href={`/planning/cours/${cours.id}/modifier`} className="bouton-principal">
              Modifier le cours
            </Link>
          )}
        </div>
      </header>

      <dl className="panneau grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-doux">Salle</dt>
          <dd>
            {cours.salle}, {cours.site}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-doux">Intervenant</dt>
          <dd>{cours.intervenant}</dd>
        </div>
        <div>
          <dt className="text-xs text-doux">Public</dt>
          <dd>{public_ || "Tous"}</dd>
        </div>
        <div>
          <dt className="text-xs text-doux">Effectif</dt>
          <dd className="flex flex-col gap-1">
            <span className="tabular-nums">
              {actifs}
              {cours.capaciteMax !== null && ` / ${cours.capaciteMax}`} inscrit{actifs > 1 ? "s" : ""}
              {complet && <span className="ml-2 rounded bg-alerte-fond px-1.5 text-xs font-medium text-alerte-texte">Complet</span>}
            </span>
            {cours.capaciteMax !== null && (
              <span className="h-1.5 overflow-hidden rounded-full bg-accent-doux" aria-hidden>
                <span
                  className={`block h-full rounded-full ${complet ? "bg-alerte-texte" : "bg-accent"}`}
                  style={{ width: `${Math.min(1, actifs / cours.capaciteMax) * 100}%` }}
                />
              </span>
            )}
            {(essais > 0 || attente > 0) && (
              <span className="text-xs text-doux">
                {[essais && `${essais} à l’essai`, attente && `${attente} en attente`].filter(Boolean).join(", ")}
              </span>
            )}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="inscrits" className="flex flex-col gap-2">
        <h2 id="inscrits" className="text-base font-semibold">
          Danseurs ({inscrits.length})
        </h2>
        {inscrits.length === 0 ? (
          <p className="text-sm text-doux">
            Personne n’est encore inscrit. Les inscriptions se font depuis la fiche de la famille.
          </p>
        ) : (
          <div className="panneau overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Danseur</th>
                  <th className="text-right">Âge</th>
                  <th>Famille</th>
                  <th>Téléphone</th>
                  <th className="print:hidden">Inscrit le</th>
                </tr>
              </thead>
              <tbody>
                {inscrits.map((i) => {
                  const statut = STATUT[i.statut];
                  const age = i.dateNaissance ? ageAu(i.dateNaissance, aujourdhui) : null;
                  const horsTranche =
                    age !== null && ((cours.ageMin !== null && age < cours.ageMin) || (cours.ageMax !== null && age > cours.ageMax));
                  return (
                    <tr key={i.danseurId}>
                      <td className="font-medium">
                        <Link href={`/danseurs/${i.danseurId}`} className="lien">
                          {i.prenom} {i.nom}
                        </Link>
                        {statut && <span className={`ml-2 rounded px-1.5 text-xs font-normal ${statut.classe}`}>{statut.libelle}</span>}
                      </td>
                      <td className={`text-right tabular-nums ${horsTranche ? "font-medium text-alerte-texte" : ""}`} title={horsTranche ? "Hors tranche d’âge du cours" : undefined}>
                        {age ?? "—"}
                        {horsTranche && <span className="sr-only"> (hors tranche d’âge)</span>}
                      </td>
                      <td>
                        <Link href={`/familles/${i.payeurId}`} className="lien">
                          {i.famille}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap tabular-nums">
                        {i.telephone ? (
                          <a href={`tel:${i.telephone.replace(/\s/g, "")}`} className="lien">
                            {i.telephone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="text-doux print:hidden">{dateCourte.format(new Date(i.dateInscription))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </article>
  );
}
