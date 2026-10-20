import Link from "next/link";
import { avecEcole } from "@/db";
import { coursDeLaSaison, saisonCourante } from "@/db/planning";
import { seancesDuJour } from "@/db/seances";
import { chiffresSaison, dernieresInscriptions } from "@/db/tableau-de-bord";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { formaterEuros } from "@/lib/montant";
import { contexteEcole, sessionCourante } from "@/lib/session";

const JOURS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
/** Seuil à partir duquel un cours est signalé « presque complet ». */
const TAUX_PRESQUE_COMPLET = 0.8;

export default async function Accueil() {
  const [{ user }, { ecoleId, role }] = await Promise.all([sessionCourante(), contexteEcole()]);
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const aujourdhui = aujourdhuiAParis();
    const saison = await saisonCourante(tx, aujourdhui);
    if (!saison) return null;
    const [chiffres, dernieres, cours, duJour] = [
      await chiffresSaison(tx, saison.id),
      await dernieresInscriptions(tx, saison.id),
      await coursDeLaSaison(tx, saison.id),
      await seancesDuJour(tx, aujourdhui),
    ];
    return { saison, chiffres, dernieres, cours, duJour };
  });

  const prenom = user.name.split(" ")[0];
  if (!donnees) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="titre-page">Bonjour {prenom}</h1>
        <p className="text-sm text-doux">Aucune saison n’est encore paramétrée : commencez par créer la saison.</p>
      </section>
    );
  }

  const { saison, chiffres, dernieres, cours, duJour } = donnees;
  const presqueComplets = cours
    .filter((c) => c.capaciteMax && c.inscrits / c.capaciteMax >= TAUX_PRESQUE_COMPLET)
    .sort((a, b) => b.inscrits / (b.capaciteMax ?? 1) - a.inscrits / (a.capaciteMax ?? 1));

  return (
    <section className="flex w-full min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titre-page">Bonjour {prenom}</h1>
          <p className="text-sm text-doux">Saison {saison.libelle}</p>
        </div>
        <div className="flex gap-2">
          {role !== "professeur" && <Link href="/personnes" className="bouton-principal">
            Inscrire quelqu’un
          </Link>}
          <Link href="/planning" className="bouton-secondaire">
            Voir le planning
          </Link>
        </div>
      </div>

      <dl
        className={`panneau grid divide-x divide-bordure ${role === "direction" ? "grid-cols-3" : "grid-cols-2"}`}
      >
        <div className="px-3 py-3 sm:px-4">
          <dt className="text-xs text-doux">Inscriptions</dt>
          <dd className="text-lg font-semibold tabular-nums sm:text-2xl">{chiffres.inscriptions}</dd>
        </div>
        <div className="px-3 py-3 sm:px-4">
          <dt className="text-xs text-doux">Danseurs inscrits</dt>
          <dd className="text-lg font-semibold tabular-nums sm:text-2xl">{chiffres.danseurs}</dd>
        </div>
        {role === "direction" && (
          <div className="px-3 py-3 sm:px-4">
            <dt className="text-xs text-doux">Montant inscrit</dt>
            <dd className="text-lg font-semibold tabular-nums sm:text-2xl">{formaterEuros(chiffres.totalNetCentimes)}</dd>
          </div>
        )}
      </dl>

      <section aria-labelledby="jour" className="flex flex-col gap-2">
        <h2 id="jour" className="text-base font-semibold">
          Séances du jour
        </h2>
        {duJour.length > 0 && <p className="text-sm text-doux">
          {duJour.filter((s) => s.statut !== "annulee" && !s.appelFait).length} appel(s) à faire · {duJour.filter((s) => s.statut !== "annulee" && s.appelFait).length} fait(s) · {duJour.filter((s) => s.statut === "annulee").length} séance(s) annulée(s)
        </p>}
        {duJour.length === 0 ? (
          <p className="text-sm text-doux">Pas de cours aujourd’hui.</p>
        ) : (
          <ul className="panneau divide-y divide-bordure text-sm">
            {duJour.map((s) => (
              <li key={s.id} className={`flex flex-wrap items-baseline gap-x-3 px-3 py-2 ${s.statut === "annulee" ? "text-doux" : ""}`}>
                <span className="w-12 tabular-nums">{s.heureDebut}</span>
                <span className={`font-medium ${s.statut === "annulee" ? "line-through" : ""}`}>
                  {s.discipline}
                  {s.niveau && ` ${s.niveau}`}
                </span>
                <span className="text-doux">
                  {s.salle}, {s.intervenant}
                </span>
                <Link href={`/planning/seances/${s.id}`} className={`ml-auto ${s.appelFait || s.statut === "annulee" ? "lien text-doux" : "bouton-secondaire"}`}>
                  {s.statut === "annulee" ? "Annulée" : s.appelFait ? "Appel fait" : "Faire l’appel"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="dernieres" className="flex flex-col gap-2">
          <h2 id="dernieres" className="text-base font-semibold">
            Dernières inscriptions
          </h2>
          {dernieres.length === 0 ? (
            <p className="text-sm text-doux">Aucune inscription pour l’instant. Recherchez une personne pour commencer.</p>
          ) : (
            <div className="panneau overflow-x-auto">
              <table className="tableau">
                <thead>
                  <tr>
                    <th>Payeur</th>
                    <th>Danseur</th>
                    <th className="text-right">Prix</th>
                  </tr>
                </thead>
                <tbody>
                  {dernieres.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/personnes/${d.payeurId}`} className="lien">
                          {d.payeur}
                        </Link>
                      </td>
                      <td>{d.danseurs}</td>
                      <td className="text-right tabular-nums">{formaterEuros(d.prixNetCentimes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="complets" className="flex flex-col gap-2">
          <h2 id="complets" className="text-base font-semibold">
            Cours presque complets
          </h2>
          {presqueComplets.length === 0 ? (
            <p className="text-sm text-doux">Tous les cours ont encore de la place.</p>
          ) : (
            <div className="panneau overflow-x-auto">
              <table className="tableau">
                <thead>
                  <tr>
                    <th>Cours</th>
                    <th>Créneau</th>
                    <th className="text-right">Occupation</th>
                  </tr>
                </thead>
                <tbody>
                  {presqueComplets.map((c) => (
                    <tr key={c.id}>
                      <td><Link className="lien" href={`/planning/cours/${c.id}`}>{c.discipline}</Link></td>
                      <td>
                        {c.jourSemaine ? JOURS[c.jourSemaine] : "stage"} {c.heureDebut}
                      </td>
                      <td className="text-right tabular-nums">
                        {c.inscrits} / {c.capaciteMax}
                        <span className="block text-xs text-doux">{c.inscrits >= (c.capaciteMax ?? 0) ? "Complet" : `${(c.capaciteMax ?? 0) - c.inscrits} place(s) restante(s)`}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
