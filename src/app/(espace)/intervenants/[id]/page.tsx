import type { Metadata } from "next";
import { Anchor, Paper, Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { calendarState } from "@/db/calendar-feed";
import { PROVIDER_NAME } from "@/connectors/calendar/oauth";
import { connectionState } from "@/db/calendar-connections";
import { listUnavailabilities } from "@/db/unavailabilities";
import { readInstructor, PAY_MODES, VAT_REGIMES, STATUSES, PAY_UNITS } from "@/db/instructors";
import { instructorCourseRates } from "@/db/courses";
import { DAY_NAMES } from "@/domain/schedule/days";
import { ButtonLink } from "@/app/(espace)/_ui/button-link";
import { BackToList } from "@/app/(espace)/_ui/list-return";
import { end } from "@/app/(espace)/planning/format";
import { courseRateSections } from "@/domain/payroll/course-rates";
import { courseRateAllowed } from "@/domain/payroll/rate";
import { hasStatement } from "@/domain/payroll/statement";
import { todayInParis } from "@/domain/people/age";
import { formatEuros } from "@/lib/money";
import { requireRole } from "@/lib/session";
import { CalendarSubscription } from "./calendar-subscription";
import { CourseRates } from "./course-rates";
import { Unavailabilities } from "./unavailabilities";

export const metadata: Metadata = { title: "Intervenant" };

export default async function InstructorPage({ params }: PageProps<"/intervenants/[id]">) {
  const { schoolId: schoolId } = await requireRole("director");
  const { id } = await params;
  const parsed = await withSchool(schoolId, async (tx) => {
    const i = await readInstructor(tx, id);
    return i
      ? {
          instructor: i,
          calendar: await calendarState(tx, i.id),
          connection: await connectionState(tx, i.id),
          unavailabilities: await listUnavailabilities(tx, i.id, new Date()),
          courses: await instructorCourseRates(tx, i.id),
        }
      : null;
  });
  if (!parsed) notFound();
  const {
    instructor: instructor,
    calendar: calendar,
    connection: connection,
    unavailabilities: unavailabilities,
    courses,
  } = parsed;
  // Rates per course: hourly or per lesson pay only (#192); a monthly flat instructor's stored ones stay read-only.
  const rated = courseRateAllowed(instructor.payMode);
  const sections = courseRateSections(courses, todayInParis());
  const storedRates = courses.filter((c) => c.rate !== null);
  const row = (c: (typeof courses)[number]) => ({
    id: c.id,
    name: `${c.discipline}${c.level ? ` ${c.level}` : ""}`,
    slot: c.weekday
      ? `${DAY_NAMES[c.weekday]} ${c.startTime}–${end(c.startTime, c.durationMinutes)}`
      : "À des dates précises",
    season: c.season,
    rate: c.rate,
  });

  const name = `${instructor.firstName} ${instructor.name}`;
  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <BackToList list="/intervenants" size="sm">
          Intervenants
        </BackToList>
        <Text span size="sm" c="dimmed">
          {" "}
          / {name}
        </Text>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Title order={1} fz="xl">
            {name}
          </Title>
          <Text size="sm" c="dimmed">
            {instructor.active ? "Actif" : "Inactif"}
            {instructor.isOwner && ", dirigeant de l’école"}
          </Text>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Owners get no statement (#285). */}
          {hasStatement(instructor) && (
            <ButtonLink href={`/intervenants/${id}/releve`} variant="default">
              Relevé du mois
            </ButtonLink>
          )}
          <ButtonLink href={`/intervenants/${id}/modifier`} variant="default">
            Modifier la fiche
          </ButtonLink>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Paper withBorder p="md" component="section" aria-labelledby="identite">
          <Title order={2} size="h5" id="identite" mb="sm">
            Coordonnées et statut
          </Title>
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
            <Text component="dt" size="sm" c="dimmed">
              E-mail
            </Text>
            <dd className="break-all">
              {instructor.email ? (
                <Anchor href={`mailto:${instructor.email}`} size="sm">
                  {instructor.email}
                </Anchor>
              ) : (
                "Non renseigné"
              )}
            </dd>
            <Text component="dt" size="sm" c="dimmed">
              Statut
            </Text>
            <dd>{STATUSES[instructor.status]}</dd>
            {instructor.status !== "employee" && (
              <>
                <Text component="dt" size="sm" c="dimmed">
                  SIREN
                </Text>
                <dd>{instructor.siren || "Non renseigné"}</dd>
              </>
            )}
            <Text component="dt" size="sm" c="dimmed">
              TVA
            </Text>
            <dd>{VAT_REGIMES[instructor.vatRegime]}</dd>
          </dl>
        </Paper>
        <Paper withBorder p="md" component="section" aria-labelledby="remuneration">
          <Title order={2} size="h5" id="remuneration" mb="sm">
            Rémunération
          </Title>
          <Text size="sm">{PAY_MODES[instructor.payMode]}</Text>
          <Text mt="xs" size="xl" fw={600} className="tabular-nums">
            {formatEuros(instructor.rateCents)}{" "}
            <Text span size="sm" fw={400} c="dimmed">
              / {PAY_UNITS[instructor.payMode]}
            </Text>
          </Text>
          <Text mt="xs" size="xs" c="dimmed">
            {/* A monthly flat instructor has no rate per course below (#192). */}
            {rated ? "Tarif habituel, sauf pour les cours ci-dessous. " : ""}Ce montant n’est pas un relevé à payer.
          </Text>
        </Paper>
      </div>
      {/* Always shown, so that the director finds per-course rates here (#276); a monthly flat instructor has none to set. */}
      {(rated || storedRates.length > 0) && (
        <CourseRates
          instructor={{
            id: instructor.id,
            firstName: instructor.firstName,
            payMode: instructor.payMode,
            rateCents: instructor.rateCents,
          }}
          editable={rated}
          current={rated ? sections.editable.map(row) : []}
          history={rated ? sections.history.map(row) : storedRates.map(row)}
        />
      )}
      <Unavailabilities
        instructorId={instructor.id}
        firstName={instructor.firstName}
        unavailabilities={unavailabilities.map((i) => ({
          ...i,
          start: i.start.toISOString(),
          end: i.end.toISOString(),
        }))}
      />
      <CalendarSubscription
        instructorId={instructor.id}
        firstName={instructor.firstName}
        activeSince={calendar?.toISOString() ?? null}
        connection={
          connection
            ? {
                provider: PROVIDER_NAME[connection.provider],
                account: connection.account,
                lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
                error: connection.error,
              }
            : null
        }
      />
    </section>
  );
}
