import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { avecEcole } from "@/db";
import { coursDuPlanning, inscritsDuCours } from "@/db/planning";
import { seancesDuCours } from "@/db/seances";
import { ageAu, aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";
import { ages, fin, JOURS } from "../../format";
import { BoutonImprimer } from "./imprimer";

export const metadata: Metadata = { title: "Cours" };

const STATUT = {
  active: null,
  essai: { libelle: "à l’essai", classe: "bg-accent-doux text-texte" },
  liste_attente: { libelle: "en attente", classe: "bg-alerte-fond text-alerte-texte" },
} as const;

const dateSeance = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dateCourte = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function PageCours({ params, searchParams }: PageProps<"/planning/cours/[id]">) {
  const { ecoleId, role } = await exigerRole("direction", "accueil");
  const [{ id }, { modifie }] = await Promise.all([params, searchParams]);
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const cours = await coursDuPlanning(tx, id);
    return cours ? { cours, inscrits: await inscritsDuCours(tx, cours.id), seances: await seancesDuCours(tx, cours.id) } : null;
  });
  if (!donnees) notFound();
  const { cours, inscrits, seances } = donnees;
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

      <section aria-labelledby="seances" className="flex flex-col gap-2 print:hidden">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="seances" className="text-base font-semibold">
            Séances
          </h2>
          {role === "direction" && (
            <Link href="/planning/fermetures" className="lien text-sm">
              Fermetures
            </Link>
          )}
        </div>
        {seances.length === 0 ? (
          <p className="text-sm text-doux">
            Aucune séance générée.{role === "direction" && " Utilisez « Mettre à jour les séances » dans Fermetures."}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5 text-sm">
            {[...seances.filter((s) => s.date < aujourdhui).slice(-4), ...seances.filter((s) => s.date >= aujourdhui).slice(0, 4)].map((s) => (
              <li key={s.id}>
                <Link
                  href={`/planning/seances/${s.id}`}
                  className={`flex flex-col rounded-md border px-2.5 py-1 hover:border-accent ${s.date === aujourdhui ? "border-accent bg-accent-doux" : "border-bordure"} ${s.statut === "annulee" ? "text-doux line-through" : ""}`}
                >
                  <span className="tabular-nums">{dateSeance.format(new Date(`${s.date}T00:00:00Z`))}</span>
                  <span className="text-xs text-doux">
                    {s.statut === "annulee"
                      ? "annulée"
                      : s.statut === "effectuee"
                        ? `${s.presents} présent${s.presents > 1 ? "s" : ""}${s.absents ? `, ${s.absents} abs.` : ""}`
                        : s.date <= aujourdhui
                          ? "appel à faire"
                          : "prévue"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="inscrits" className="flex flex-col gap-2">
        <h2 id="inscrits" className="text-base font-semibold">
          Danseurs ({inscrits.length})
        </h2>
        {inscrits.length === 0 ? (
          <p className="text-sm text-doux">
            Personne n’est encore inscrit. Les inscriptions se font depuis la fiche du danseur ou de la personne qui paie.
          </p>
        ) : (
          <div className="panneau overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Danseur</th>
                  <th className="text-right">Âge</th>
                  <th className="hidden sm:table-cell">Payeur</th>
                  <th>Téléphone</th>
                  <th className="hidden sm:table-cell print:hidden">Inscrit le</th>
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
                        <Link href={`/personnes/${i.danseurId}`} className="lien">
                          {i.prenom} {i.nom}
                        </Link>
                        {statut && <span className={`ml-2 rounded px-1.5 text-xs font-normal ${statut.classe}`}>{statut.libelle}</span>}
                      </td>
                      <td className={`text-right tabular-nums ${horsTranche ? "font-medium text-alerte-texte" : ""}`} title={horsTranche ? "Hors tranche d’âge du cours" : undefined}>
                        {age ?? "—"}
                        {horsTranche && <span className="sr-only"> (hors tranche d’âge)</span>}
                      </td>
                      <td className="hidden sm:table-cell">
                        <Link href={`/personnes/${i.payeurId}`} className="lien">
                          {i.payeur}
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
                      <td className="hidden text-doux sm:table-cell print:hidden">{dateCourte.format(new Date(i.dateInscription))}</td>
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
