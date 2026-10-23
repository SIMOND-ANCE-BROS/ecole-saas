import Link from "next/link";
import { withSchool } from "@/db";
import { seasonCourses, currentSeason } from "@/db/planning";
import { dayLessons } from "@/db/seances";
import { seasonFigures, lastEnrollments } from "@/db/tableau-de-bord";
import { todayInParis } from "@/domaine/personnes/age";
import { formatEuros } from "@/lib/montant";
import { schoolContext, currentSession } from "@/lib/session";

const DAYS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
/** Seuil à partir duquel un cours est signalé « presque complet ». */
const ALMOST_FULL_RATE = 0.8;

export default async function FrontDesk() {
  const [{ user }, { schoolId: schoolId, role }] = await Promise.all([currentSession(), schoolContext()]);
  const donnees = await withSchool(schoolId, async (tx) => {
    const today = todayInParis();
    const season = await currentSeason(tx, today);
    if (!season) return null;
    const [digits, dernieres, courses, ofDay] = [
      await seasonFigures(tx, season.id),
      await lastEnrollments(tx, season.id),
      await seasonCourses(tx, season.id),
      await dayLessons(tx, today),
    ];
    return { season: season, digits: digits, dernieres, cours: courses, ofDay: ofDay };
  });

  const firstName = user.name.split(" ")[0];
  if (!donnees) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="titre-page">Bonjour {firstName}</h1>
        <p className="text-sm text-doux">Aucune saison n’est encore paramétrée : commencez par créer la saison.</p>
      </section>
    );
  }

  const { season: season, digits: digits, dernieres, cours, ofDay: ofDay } = donnees;
  const almostFull = cours
    .filter((c) => c.maxCapacity && c.enrolled / c.maxCapacity >= ALMOST_FULL_RATE)
    .sort((a, b) => b.enrolled / (b.maxCapacity ?? 1) - a.enrolled / (a.maxCapacity ?? 1));

  return (
    <section className="flex w-full min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titre-page">Bonjour {firstName}</h1>
          <p className="text-sm text-doux">Saison {season.label}</p>
        </div>
        <div className="flex gap-2">
          {role !== "professeur" && (
            <Link href="/eleves/nouveau" className="bouton-principal">
              Nouvel élève
            </Link>
          )}
          <Link href="/planning" className="bouton-secondaire">
            Voir le planning
          </Link>
        </div>
      </div>

      <dl className={`panneau grid divide-x divide-bordure ${role === "direction" ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="px-3 py-3 sm:px-4">
          <dt className="text-xs text-doux">Inscriptions</dt>
          <dd className="text-lg font-semibold tabular-nums sm:text-2xl">{digits.enrollments}</dd>
        </div>
        <div className="px-3 py-3 sm:px-4">
          <dt className="text-xs text-doux">Danseurs inscrits</dt>
          <dd className="text-lg font-semibold tabular-nums sm:text-2xl">{digits.students}</dd>
        </div>
        {role === "direction" && (
          <div className="px-3 py-3 sm:px-4">
            <dt className="text-xs text-doux">Montant inscrit</dt>
            <dd className="text-lg font-semibold tabular-nums sm:text-2xl">{formatEuros(digits.netTotalCents)}</dd>
          </div>
        )}
      </dl>

      <section aria-labelledby="jour" className="flex flex-col gap-2">
        <h2 id="jour" className="text-base font-semibold">
          Séances du jour
        </h2>
        {ofDay.length > 0 && (
          <p className="text-sm text-doux">
            {ofDay.filter((s) => s.status !== "annulee" && !s.doneAttendance).length} appel(s) à faire ·{" "}
            {ofDay.filter((s) => s.status !== "annulee" && s.doneAttendance).length} fait(s) ·{" "}
            {ofDay.filter((s) => s.status === "annulee").length} séance(s) annulée(s)
          </p>
        )}
        {ofDay.length === 0 ? (
          <p className="text-sm text-doux">Pas de cours aujourd’hui.</p>
        ) : (
          <ul className="panneau divide-y divide-bordure text-sm">
            {ofDay.map((s) => (
              <li
                key={s.id}
                className={`flex flex-wrap items-baseline gap-x-3 px-3 py-2 ${s.status === "annulee" ? "text-doux" : ""}`}
              >
                <span className="w-12 tabular-nums">{s.startTime}</span>
                <span className={`font-medium ${s.status === "annulee" ? "line-through" : ""}`}>
                  {s.discipline}
                  {s.level && ` ${s.level}`}
                </span>
                <span className="text-doux">
                  {s.room}, {s.instructor}
                </span>
                <Link
                  href={`/planning/seances/${s.id}`}
                  className={`ml-auto ${s.doneAttendance || s.status === "annulee" ? "lien text-doux" : "bouton-secondaire"}`}
                >
                  {s.status === "annulee" ? "Annulée" : s.doneAttendance ? "Appel fait" : "Faire l’appel"}
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
            <p className="text-sm text-doux">
              Aucune inscription pour l’instant. Recherchez une personne pour commencer.
            </p>
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
                        <Link href={`/personnes/${d.payerId}`} className="lien">
                          {d.payer}
                        </Link>
                      </td>
                      <td>{d.students}</td>
                      <td className="text-right tabular-nums">{formatEuros(d.netPriceCents)}</td>
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
          {almostFull.length === 0 ? (
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
                  {almostFull.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link className="lien" href={`/planning/cours/${c.id}`}>
                          {c.discipline}
                        </Link>
                      </td>
                      <td>
                        {c.weekday ? DAYS[c.weekday] : "stage"} {c.startTime}
                      </td>
                      <td className="text-right tabular-nums">
                        {c.enrolled} / {c.maxCapacity}
                        <span className="block text-xs text-doux">
                          {c.enrolled >= (c.maxCapacity ?? 0)
                            ? "Complet"
                            : `${(c.maxCapacity ?? 0) - c.enrolled} place(s) restante(s)`}
                        </span>
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
