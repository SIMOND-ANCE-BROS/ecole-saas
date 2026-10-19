import Link from "next/link";
import { avecEcole } from "@/db";
import { coursDeLaSaison, saisonCourante } from "@/db/planning";
import { chiffresSaison, dernieresInscriptions } from "@/db/tableau-de-bord";
import { aujourdhuiAParis } from "@/domaine/familles/age";
import { formaterEuros } from "@/lib/montant";
import { contexteEcole, sessionCourante } from "@/lib/session";

const JOURS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
/** Seuil à partir duquel un cours est signalé « presque complet ». */
const TAUX_PRESQUE_COMPLET = 0.8;

export default async function Accueil() {
  const [{ user }, { ecoleId, role }] = await Promise.all([sessionCourante(), contexteEcole()]);
  const donnees = await avecEcole(ecoleId, async (tx) => {
    const saison = await saisonCourante(tx, aujourdhuiAParis());
    if (!saison) return null;
    const [chiffres, dernieres, cours] = [
      await chiffresSaison(tx, saison.id),
      await dernieresInscriptions(tx, saison.id),
      await coursDeLaSaison(tx, saison.id),
    ];
    return { saison, chiffres, dernieres, cours };
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

  const { saison, chiffres, dernieres, cours } = donnees;
  const presqueComplets = cours
    .filter((c) => c.capaciteMax && c.inscrits / c.capaciteMax >= TAUX_PRESQUE_COMPLET)
    .sort((a, b) => b.inscrits / (b.capaciteMax ?? 1) - a.inscrits / (a.capaciteMax ?? 1));

  return (
    <section className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titre-page">Bonjour {prenom}</h1>
          <p className="text-sm text-doux">Saison {saison.libelle}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/familles" className="bouton-principal">
            Inscrire une famille
          </Link>
          <Link href="/planning" className="bouton-secondaire">
            Voir le planning
          </Link>
        </div>
      </div>

      <dl
        className={`panneau grid grid-cols-1 divide-y divide-bordure sm:divide-x sm:divide-y-0 ${role === "direction" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
      >
        <div className="px-4 py-3">
          <dt className="text-xs text-doux">Inscriptions</dt>
          <dd className="text-2xl font-semibold tabular-nums">{chiffres.inscriptions}</dd>
        </div>
        <div className="px-4 py-3">
          <dt className="text-xs text-doux">Danseurs inscrits</dt>
          <dd className="text-2xl font-semibold tabular-nums">{chiffres.danseurs}</dd>
        </div>
        {role === "direction" && (
          <div className="px-4 py-3">
            <dt className="text-xs text-doux">Montant inscrit</dt>
            <dd className="text-2xl font-semibold tabular-nums">{formaterEuros(chiffres.totalNetCentimes)}</dd>
          </div>
        )}
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="dernieres" className="flex flex-col gap-2">
          <h2 id="dernieres" className="text-base font-semibold">
            Dernières inscriptions
          </h2>
          {dernieres.length === 0 ? (
            <p className="text-sm text-doux">Aucune inscription pour l’instant. Recherchez une famille pour commencer.</p>
          ) : (
            <div className="panneau overflow-x-auto">
              <table className="tableau">
                <thead>
                  <tr>
                    <th>Famille</th>
                    <th>Danseur</th>
                    <th className="text-right">Prix</th>
                  </tr>
                </thead>
                <tbody>
                  {dernieres.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/familles/${d.payeurId}`} className="lien">
                          {d.famille}
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
                    <th className="text-right">Places</th>
                  </tr>
                </thead>
                <tbody>
                  {presqueComplets.map((c) => (
                    <tr key={c.id}>
                      <td>{c.discipline}</td>
                      <td>
                        {c.jourSemaine ? JOURS[c.jourSemaine] : "stage"} {c.heureDebut}
                      </td>
                      <td className="text-right tabular-nums">
                        {c.inscrits} / {c.capaciteMax}
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
