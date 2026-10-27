import {
  Alert,
  Anchor,
  Badge,
  Paper,
  Progress,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
} from "@mantine/core";
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
import { ButtonLink } from "@/app/(espace)/_ui/button-link";
import { TextLink } from "@/app/(espace)/_ui/text-link";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Cours" };

const STATUS = {
  active: null,
  trial: { label: "à l’essai", color: "indigo" },
  waitlist: { label: "en attente", color: "yellow" },
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
  const parsed = await withSchool(schoolId, async (tx) => {
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
  if (!parsed) notFound();
  const { cours, enrolled: enrolled, lessons: lessons, inConflict: inConflict } = parsed;
  const today = todayInParis();

  const active = enrolled.filter((i) => i.status === "active").length;
  const trials = enrolled.filter((i) => i.status === "trial").length;
  const waitlist = enrolled.filter((i) => i.status === "waitlist").length;
  const full = cours.maxCapacity !== null && active >= cours.maxCapacity;
  // « Chaque lundi 17:00–18:00 », « Un mercredi sur deux… », « Le sam. 24 oct., … 10:00–12:00 » (#90).
  const slot = `${recurrenceText(cours)}, ${cours.startTime}–${end(cours.startTime, cours.durationMinutes)}`;
  const public_ = [ages(cours.ageMin, cours.ageMax), cours.level].filter(Boolean).join(", ");

  return (
    <article className="flex w-full min-w-0 flex-col gap-5">
      <nav aria-label="Fil d’Ariane" className="text-sm print:hidden">
        <TextLink href={`/planning?saison=${cours.seasonId}`} size="sm">
          Planning
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / {cours.discipline}
        </Text>
      </nav>

      {modifie && (
        <Alert role="status" className="print:hidden">
          Cours modifié.
        </Alert>
      )}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Title order={1} fz="xl">
            {cours.discipline}
            {cours.level && (
              <Text span inherit fw={400} c="dimmed">
                {" "}
                {cours.level}
              </Text>
            )}
          </Title>
          <Text size="sm">{slot}</Text>
        </div>
        <div className="flex gap-2 print:hidden">
          <PrintButton />
          {role === "director" && (
            <ButtonLink href={`/planning/cours/${cours.id}/modifier`}>Modifier le cours</ButtonLink>
          )}
        </div>
      </header>

      <Paper withBorder component="dl" p="md" className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
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
                <Badge color="yellow" variant="light" ml="xs">
                  Complet
                </Badge>
              )}
            </span>
            {cours.maxCapacity !== null && (
              <Progress
                aria-hidden
                size="sm"
                color={full ? "yellow" : undefined}
                value={Math.min(1, active / cours.maxCapacity) * 100}
              />
            )}
            {(trials > 0 || waitlist > 0) && (
              <span className="text-xs text-doux">
                {[trials && `${trials} à l’essai`, waitlist && `${waitlist} en attente`].filter(Boolean).join(", ")}
              </span>
            )}
          </dd>
        </div>
      </Paper>

      <section aria-labelledby="seances" className="flex flex-col gap-2 print:hidden">
        <div className="flex items-baseline justify-between gap-2">
          <Title order={2} size="h5" id="seances">
            Séances
          </Title>
          {role === "director" && (
            <TextLink href="/planning/fermetures" size="sm">
              Fermetures
            </TextLink>
          )}
        </div>
        {lessons.length === 0 ? (
          <Text size="sm" c="dimmed">
            Aucune séance générée.{role === "director" && " Utilisez « Mettre à jour les séances » dans Fermetures."}
          </Text>
        ) : (
          <ul className="flex flex-wrap gap-1.5 text-sm">
            {[
              ...lessons.filter((s) => s.date < today).slice(-4),
              ...lessons.filter((s) => s.date >= today).slice(0, 4),
            ].map((s) => (
              <li key={s.id}>
                <Link
                  href={`/planning/seances/${s.id}`}
                  className={`flex flex-col rounded-md border px-2.5 py-1 hover:border-accent ${inConflict.has(s.id) ? "border-alerte-texte bg-alerte-fond" : s.date === today ? "border-accent bg-accent-doux" : "border-bordure"} ${s.status === "cancelled" ? "text-doux line-through" : ""}`}
                >
                  <span className="tabular-nums">{lessonDate.format(new Date(`${s.date}T00:00:00Z`))}</span>
                  <span className="text-xs text-doux">
                    {inConflict.has(s.id)
                      ? "prof indisponible"
                      : s.status === "cancelled"
                        ? "annulée"
                        : s.status === "done"
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
        <Title order={2} size="h5" id="inscrits">
          Danseurs ({enrolled.length})
        </Title>
        {enrolled.length === 0 ? (
          <Text size="sm" c="dimmed">
            Personne n’est encore inscrit. Les inscriptions se font depuis la fiche du danseur ou de la personne qui
            paie.
          </Text>
        ) : (
          <Paper withBorder className="overflow-x-auto">
            <Table>
              <TableThead>
                <TableTr>
                  <TableTh>Danseur</TableTh>
                  <TableTh className="text-right">Âge</TableTh>
                  <TableTh className="hidden sm:table-cell">Payeur</TableTh>
                  <TableTh>Téléphone</TableTh>
                  <TableTh className="hidden sm:table-cell print:hidden">Inscrit le</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {enrolled.map((i) => {
                  const status = STATUS[i.status];
                  const age = i.birthDate ? ageAt(i.birthDate, today) : null;
                  const outsideBand =
                    age !== null &&
                    ((cours.ageMin !== null && age < cours.ageMin) || (cours.ageMax !== null && age > cours.ageMax));
                  return (
                    <TableTr key={i.studentId}>
                      <TableTd className="font-medium">
                        <TextLink href={`/eleves/${i.studentId}`} inherit>
                          {i.firstName} {i.name}
                        </TextLink>
                        {status && (
                          <Badge color={status.color} variant="light" ml="xs">
                            {status.label}
                          </Badge>
                        )}
                      </TableTd>
                      <TableTd
                        className={`text-right tabular-nums ${outsideBand ? "font-medium text-alerte-texte" : ""}`}
                        title={outsideBand ? "Hors tranche d’âge du cours" : undefined}
                      >
                        {age ?? "—"}
                        {outsideBand && <span className="sr-only"> (hors tranche d’âge)</span>}
                      </TableTd>
                      <TableTd className="hidden sm:table-cell">
                        <TextLink href={`/personnes/${i.payerId}`} inherit>
                          {i.payer}
                        </TextLink>
                      </TableTd>
                      <TableTd className="whitespace-nowrap tabular-nums">
                        {i.telephone ? (
                          <Anchor href={`tel:${i.telephone.replace(/\s/g, "")}`} inherit>
                            {i.telephone}
                          </Anchor>
                        ) : (
                          "—"
                        )}
                      </TableTd>
                      <TableTd className="hidden text-doux sm:table-cell print:hidden">
                        {shortDate.format(new Date(i.enrollmentDate))}
                      </TableTd>
                    </TableTr>
                  );
                })}
              </TableTbody>
            </Table>
          </Paper>
        )}
      </section>
    </article>
  );
}
