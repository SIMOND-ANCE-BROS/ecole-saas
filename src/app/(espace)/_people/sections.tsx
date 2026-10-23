import Link from "next/link";
import type { PaidEnrollment } from "@/db/enrollments";
import type { PersonRecord } from "@/db/people";
import { ENROLLMENT_STATUS_LABELS as STATUT } from "@/domain/enrollment/statuses";
import { formatEuros } from "@/lib/money";
import { DAYS } from "../planning/format";

/** Sections communes aux fiches élève et contact. */

const DOCUMENT = {
  certificat_medical: "Certificat médical",
  autorisation_parentale: "Autorisation parentale",
  droit_image: "Droit à l’image",
  autre: "Autre document",
} as const;
const PERIOD = { trimestre: "trimestre", annee: "année", unite: "unité" } as const;
const PUBLIC = { enfant: "Enfant", adulte: "Adulte", couple: "Couple", etudiant: "Étudiant" } as const;

const longDate = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
export const dayOf = (iso: string) => longDate.format(new Date(`${iso}T00:00:00Z`));

export const Telephone = ({ number: number }: { number: string }) => (
  <a href={`tel:${number.replace(/\s/g, "")}`} className="lien tabular-nums">
    {number}
  </a>
);

export function Bandeau({ texte }: { texte?: string }) {
  if (!texte) return null;
  return (
    <p role="status" className="rounded-md border border-accent bg-accent-doux px-3 py-2 text-sm">
      {texte}
    </p>
  );
}

export function Notes({ notes }: { notes: string | null }) {
  if (!notes) return null;
  return (
    <section
      aria-label="Santé et consignes"
      className="rounded-md border border-alerte-texte/40 bg-alerte-fond px-3 py-2 text-sm text-alerte-texte"
    >
      <p className="whitespace-pre-line">{notes}</p>
    </section>
  );
}

export function FollowedCourses({ courses: cours }: { courses: PersonRecord["courses"] }) {
  const season = cours[0]?.season;
  const current = cours.filter((c) => c.season === season);
  const history = cours.filter((c) => c.season !== season);
  return (
    <>
      <section aria-labelledby="cours" className="flex flex-col gap-2">
        <h2 id="cours" className="text-base font-semibold">
          Cours{season && ` ${season}`}
        </h2>
        {current.length === 0 ? (
          <p className="text-sm text-doux">Aucun cours pour l’instant.</p>
        ) : (
          <ul className="panneau divide-y divide-bordure text-sm">
            {current.map((c) => (
              <li key={`${c.id}-${c.status}`} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                <Link href={`/planning/cours/${c.id}`} className="lien font-medium">
                  {c.discipline}
                  {c.level && ` ${c.level}`}
                </Link>
                <span className="tabular-nums">
                  {c.weekday ? DAYS[c.weekday] : "Stage"} {c.startTime}
                </span>
                {c.presents + c.absents > 0 && (
                  <span className={`text-xs ${c.absents > c.presents ? "text-alerte-texte" : "text-doux"}`}>
                    présent {c.presents} fois sur {c.presents + c.absents}
                  </span>
                )}
                <span
                  className={`ml-auto text-xs ${c.status === "active" ? "text-doux" : "font-medium text-alerte-texte"}`}
                >
                  {STATUT[c.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {history.length > 0 && (
        <section aria-labelledby="historique" className="flex flex-col gap-2">
          <h2 id="historique" className="text-base font-semibold">
            Saisons précédentes
          </h2>
          <ul className="flex flex-col gap-1 text-sm text-doux">
            {history.map((c) => (
              <li key={`${c.id}-${c.status}`}>
                {c.season} : {c.discipline}
                {c.level && ` ${c.level}`} ({STATUT[c.status].toLowerCase()})
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function Documents({ documents, today: today }: { documents: PersonRecord["documents"]; today: string }) {
  return (
    <section aria-labelledby="documents" className="flex flex-col gap-2">
      <h2 id="documents" className="text-base font-semibold">
        Documents
      </h2>
      {documents.length === 0 ? (
        <p className="text-sm text-doux">Aucun document enregistré (certificat médical, autorisations).</p>
      ) : (
        <ul className="panneau divide-y divide-bordure text-sm">
          {documents.map((d, i) => {
            const expiresAt = d.validUntil !== null && d.validUntil < today;
            return (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                <span className="font-medium">{DOCUMENT[d.type]}</span>
                <span className={expiresAt || !d.granted ? "text-alerte-texte" : "text-doux"}>
                  {!d.granted
                    ? "refusé"
                    : d.validUntil
                      ? `${expiresAt ? "expiré le" : "valable jusqu’au"} ${dayOf(d.validUntil)}`
                      : "fourni"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Inscriptions facturées à une personne : un engagement, pas un encaissement. */
export function FactureesEnrollments({
  enrollments: enrollments,
  season: season,
}: {
  enrollments: PaidEnrollment[];
  season: string;
}) {
  if (enrollments.length === 0) return null;
  const total = enrollments.reduce((s, i) => s + i.netPriceCents, 0);
  return (
    <section aria-labelledby="facturees" className="flex flex-col gap-2">
      <h2 id="facturees" className="text-base font-semibold">
        Inscriptions facturées {season}
      </h2>
      <div className="panneau overflow-x-auto">
        <table className="tableau">
          <thead>
            <tr>
              <th scope="col">Élève</th>
              <th scope="col">Cours</th>
              <th scope="col" className="hidden sm:table-cell">
                Formule
              </th>
              <th scope="col" className="text-right">
                Prix
              </th>
            </tr>
          </thead>
          <tbody>
            {enrollments.map((i) => (
              <tr key={i.id}>
                <td className="font-medium">{i.students}</td>
                <td>{i.courses.join(", ")}</td>
                <td className="hidden sm:table-cell">
                  {PUBLIC[i.audience]}, {PERIOD[i.period]}
                </td>
                <td className="text-right tabular-nums">{formatEuros(i.netPriceCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="px-3 py-2 text-right font-medium sm:hidden">
                Total
              </td>
              <td colSpan={3} className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                Total de la saison (montant inscrit, ni encaissé ni dû à ce jour)
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatEuros(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
