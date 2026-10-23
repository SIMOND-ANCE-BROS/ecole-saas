import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { scheduleCourse, enrolledInCourse } from "@/db/schedule";
import { conflictingLessons } from "@/db/unavailabilities";
import { courseLessons } from "@/db/lessons";
import { ageAt, todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { ages, end, recurrenceText } from "../../format";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Cours" };

const STATUS = {
  active: null,
  essai: { label: "à l’essai", className: "bg-accent-doux text-texte" },
  liste_attente: { label: "en attente", className: "bg-alerte-fond text-alerte-texte" },
} as const;

const lessonDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const shortDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function CoursePage({ params, searchParams }: PageProps<"/planning/cours/[id]">) {
  const { schoolId: schoolId, role } = await requireRole("director", "front_desk");
  const [{ id }, { modifie }] = await Promise.all([params, searchParams]);
  const donnees = await withSchool(schoolId, async (tx) => {
    const course = await scheduleCourse(tx, id);
    return course
      ? {
          cours: course,
          enrolled: await enrolledInCourse(tx, course.id),
          lessons: await courseLessons(tx, course.id),
          inConflict: await conflictingLessons(tx, course.id, todayInParis()),
        }
      : null;
  });
  if (!donnees) notFound();
  const { cours, enrolled: enrolled, lessons: lessons, inConflict: inConflict } = donnees;
  const today = todayInParis();

  const active = enrolled.filter((i) => i.status === "active").length;
  const trials = enrolled.filter((i) => i.status === "essai").length;
  const waitlist = enrolled.filter((i) => i.status === "liste_attente").length;
  const full = cours.maxCapacity !== null && active >= cours.maxCapacity;
  // « Chaque lundi 17:00–18:00 », « Un mercredi sur deux… », « Le sam. 24 oct., … 10:00–12:00 » (#90).
  const slot = `${recurrenceText(cours)}, ${cours.startTime}–${end(cours.startTime, cours.durationMinutes)}`;
  const public_ = [ages(cours.ageMin, cours.ageMax), cours.level].filter(Boolean).join(", ");

  return (
    <article className="flex w-full min-w-0 flex-col gap-5">
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
            {cours.level && <span className="font-normal text-doux"> {cours.level}</span>}
          </h1>
          <p className="text-sm">{slot}</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <PrintButton />
          {role === "director" && (
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
            {cours.room}, {cours.site}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-doux">Intervenant</dt>
          <dd>{cours.instructor}</dd>
        </div>
        <div>
          <dt className="text-xs text-doux">Public</dt>
          <dd>{public_ || "Tous"}</dd>
        </div>
        <div>
          <dt className="text-xs text-doux">Effectif</dt>
          <dd className="flex flex-col gap-1">
            <span className="tabular-nums">
              {active}
              {cours.maxCapacity !== null && ` / ${cours.maxCapacity}`} inscrit{active > 1 ? "s" : ""}
              {full && (
                <span className="ml-2 rounded bg-alerte-fond px-1.5 text-xs font-medium text-alerte-texte">
                  Complet
                </span>
              )}
            </span>
            {cours.maxCapacity !== null && (
              <span className="h-1.5 overflow-hidden rounded-full bg-accent-doux" aria-hidden>
                <span
                  className={`block h-full rounded-full ${full ? "bg-alerte-texte" : "bg-accent"}`}
                  style={{ width: `${Math.min(1, active / cours.maxCapacity) * 100}%` }}
                />
              </span>
            )}
            {(trials > 0 || waitlist > 0) && (
              <span className="text-xs text-doux">
                {[trials && `${trials} à l’essai`, waitlist && `${waitlist} en attente`].filter(Boolean).join(", ")}
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
          {role === "director" && (
            <Link href="/planning/fermetures" className="lien text-sm">
              Fermetures
            </Link>
          )}
        </div>
        {lessons.length === 0 ? (
          <p className="text-sm text-doux">
            Aucune séance générée.{role === "director" && " Utilisez « Mettre à jour les séances » dans Fermetures."}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5 text-sm">
            {[
              ...lessons.filter((s) => s.date < today).slice(-4),
              ...lessons.filter((s) => s.date >= today).slice(0, 4),
            ].map((s) => (
              <li key={s.id}>
                <Link
                  href={`/planning/seances/${s.id}`}
                  className={`flex flex-col rounded-md border px-2.5 py-1 hover:border-accent ${inConflict.has(s.id) ? "border-alerte-texte bg-alerte-fond" : s.date === today ? "border-accent bg-accent-doux" : "border-bordure"} ${s.status === "annulee" ? "text-doux line-through" : ""}`}
                >
                  <span className="tabular-nums">{lessonDate.format(new Date(`${s.date}T00:00:00Z`))}</span>
                  <span className="text-xs text-doux">
                    {inConflict.has(s.id)
                      ? "prof indisponible"
                      : s.status === "annulee"
                        ? "annulée"
                        : s.status === "effectuee"
                          ? `${s.presents} présent${s.presents > 1 ? "s" : ""}${s.absents ? `, ${s.absents} abs.` : ""}`
                          : s.date <= today
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
          Danseurs ({enrolled.length})
        </h2>
        {enrolled.length === 0 ? (
          <p className="text-sm text-doux">
            Personne n’est encore inscrit. Les inscriptions se font depuis la fiche du danseur ou de la personne qui
            paie.
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
                {enrolled.map((i) => {
                  const status = STATUS[i.status];
                  const age = i.birthDate ? ageAt(i.birthDate, today) : null;
                  const outsideBand =
                    age !== null &&
                    ((cours.ageMin !== null && age < cours.ageMin) || (cours.ageMax !== null && age > cours.ageMax));
                  return (
                    <tr key={i.studentId}>
                      <td className="font-medium">
                        <Link href={`/eleves/${i.studentId}`} className="lien">
                          {i.firstName} {i.name}
                        </Link>
                        {status && (
                          <span className={`ml-2 rounded px-1.5 text-xs font-normal ${status.className}`}>
                            {status.label}
                          </span>
                        )}
                      </td>
                      <td
                        className={`text-right tabular-nums ${outsideBand ? "font-medium text-alerte-texte" : ""}`}
                        title={outsideBand ? "Hors tranche d’âge du cours" : undefined}
                      >
                        {age ?? "—"}
                        {outsideBand && <span className="sr-only"> (hors tranche d’âge)</span>}
                      </td>
                      <td className="hidden sm:table-cell">
                        <Link href={`/personnes/${i.payerId}`} className="lien">
                          {i.payer}
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
                      <td className="hidden text-doux sm:table-cell print:hidden">
                        {shortDate.format(new Date(i.enrollmentDate))}
                      </td>
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
