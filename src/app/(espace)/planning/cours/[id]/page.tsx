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
import { courseOwnRate } from "@/db/courses";
import { courseRateLabel } from "@/domain/payroll/rate-field";
import { ageAt, todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { ages, end, recurrenceText } from "../../format";
import { ButtonLink } from "@/app/(espace)/_ui/button-link";
import { TextLink } from "@/app/(espace)/_ui/text-link";
import { EnrollmentStatusBadge } from "@/app/(espace)/_people/enrollment-status";
import { isFull } from "@/domain/enrollment/lifecycle";
import { PrintButton } from "./print-button";
import { coursePlanning } from "../../course-planning";

export const metadata: Metadata = { title: "Cours" };

const lessonDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const shortDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function CoursePage({ params, searchParams }: PageProps<"/planning/cours/[id]">) {
  const { schoolId, role } = await requireRole("director", "front_desk");
  const [{ id }, { modifie }] = await Promise.all([params, searchParams]);
  const parsed = await withSchool(schoolId, async (tx) => {
    const course = await scheduleCourse(tx, id);
    return course
      ? {
          course,
          planning: await coursePlanning(tx, course.id),
          enrolled: await enrolledInCourse(tx, course.id, todayInParis()),
          lessons: await courseLessons(tx, course.id),
          inConflict: await conflictingLessons(tx, course.id, todayInParis()),
          // Pay data: read for management only, so it never reaches the front desk's page (#191).
          ownRate: role === "director" ? await courseOwnRate(tx, course.id) : null,
        }
      : null;
  });
  if (!parsed) notFound();
  const { course, enrolled, lessons, inConflict } = parsed;
  const today = todayInParis();

  const active = enrolled.filter((i) => i.status === "active").length;
  const trials = enrolled.filter((i) => i.status === "trial").length;
  const waitlist = enrolled.filter((i) => i.status === "waitlist").length;
  // Drop-outs still attending until their date (#284): listed, not counted in the headcount.
  const dropping = enrolled.filter((i) => i.status === "dropped").length;
  // Only a children's course is ever full (#284): the school sets no limit on adult courses.
  const full = isFull({ enrolled: active, maxCapacity: course.maxCapacity, ageMax: course.ageMax });
  // « Chaque lundi 17:00–18:00 », « Un mercredi sur deux… », « Le sam. 24 oct., … 10:00–12:00 » (#90).
  const slot = `${recurrenceText(course)}, ${course.startTime}–${end(course.startTime, course.durationMinutes)}`;
  const public_ = [ages(course.ageMin, course.ageMax), course.level].filter(Boolean).join(", ");

  return (
    <article className="flex w-full min-w-0 flex-col gap-5">
      <nav aria-label="Fil d’Ariane" className="text-sm print:hidden">
        <TextLink href={parsed.planning.href} size="sm">
          {parsed.planning.label}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / {course.discipline}
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
            {course.discipline}
            {course.level && (
              <Text span inherit fw={400} c="dimmed">
                {" "}
                {course.level}
              </Text>
            )}
          </Title>
          <Text size="sm">{slot}</Text>
        </div>
        <div className="flex gap-2 print:hidden">
          <PrintButton />
          {role === "director" && (
            <ButtonLink href={`/planning/cours/${course.id}/modifier`}>Modifier le cours</ButtonLink>
          )}
        </div>
      </header>

      <Paper withBorder component="dl" p="md" className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-doux">Salle</dt>
          <dd>
            {course.room}, {course.site}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-doux">Intervenant</dt>
          <dd>
            {course.instructor}
            {parsed.ownRate && (
              <Text size="xs" c="dimmed" className="tabular-nums print:hidden">
                Tarif intervenant : {courseRateLabel(parsed.ownRate)}
                {parsed.ownRate.payMode === "monthly_flat"
                  ? ""
                  : parsed.ownRate.current
                    ? " (propre à ce cours)"
                    : " (tarif de l’ancien mode de rémunération)"}
              </Text>
            )}
          </dd>
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
              {course.maxCapacity !== null && ` / ${course.maxCapacity}`} inscrit{active > 1 ? "s" : ""}
              {full && (
                <Badge color="yellow" variant="light" ml="xs">
                  Complet
                </Badge>
              )}
            </span>
            {course.maxCapacity !== null && (
              <Progress
                aria-hidden
                size="sm"
                color={full ? "yellow" : undefined}
                value={Math.min(1, active / course.maxCapacity) * 100}
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
          Danseurs ({enrolled.length}
          {dropping > 0 && `, dont ${dropping} abandon${dropping > 1 ? "s" : ""} à venir`})
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
                  const age = i.birthDate ? ageAt(i.birthDate, today) : null;
                  const outsideBand =
                    age !== null &&
                    ((course.ageMin !== null && age < course.ageMin) ||
                      (course.ageMax !== null && age > course.ageMax));
                  return (
                    <TableTr key={i.studentId}>
                      <TableTd className="font-medium">
                        <TextLink href={`/eleves/${i.studentId}`} inherit>
                          {i.firstName} {i.name}
                        </TextLink>
                        {i.status !== "active" && (
                          <span className="ml-2">
                            <EnrollmentStatusBadge status={i.status} droppedOn={i.droppedOn} />
                          </span>
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
