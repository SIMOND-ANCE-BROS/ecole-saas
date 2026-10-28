import { Paper, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from "@mantine/core";
import { withSchool } from "@/db";
import { seasonCourses, currentSeason } from "@/db/schedule";
import { dayLessons } from "@/db/lessons";
import { seasonFigures, lastEnrollments } from "@/db/dashboard";
import { todayInParis } from "@/domain/people/age";
import { formatEuros } from "@/lib/money";
import { schoolContext, currentSession } from "@/lib/session";
import { ButtonLink } from "./_ui/button-link";
import { TextLink } from "./_ui/text-link";

const DAYS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
/** Threshold from which a course is flagged « presque complet ». */
const ALMOST_FULL_RATE = 0.8;

export default async function FrontDesk() {
  const [{ user }, { schoolId: schoolId, role }] = await Promise.all([currentSession(), schoolContext()]);
  const parsed = await withSchool(schoolId, async (tx) => {
    const today = todayInParis();
    const season = await currentSeason(tx, today);
    if (!season) return null;
    const [digits, latest, courses, ofDay] = [
      await seasonFigures(tx, season.id),
      await lastEnrollments(tx, season.id),
      await seasonCourses(tx, season.id),
      await dayLessons(tx, today),
    ];
    return { season, digits, latest, courses, ofDay };
  });

  const firstName = user.name.split(" ")[0];
  if (!parsed) {
    return (
      <section className="flex flex-col gap-2">
        <Title order={1} fz="xl">
          Bonjour {firstName}
        </Title>
        <Text size="sm" c="dimmed">
          Aucune saison n’est encore paramétrée : commencez par créer la saison.
        </Text>
      </section>
    );
  }

  const { season, digits, latest, courses, ofDay } = parsed;
  const almostFull = courses
    .filter((c) => c.maxCapacity && c.enrolled / c.maxCapacity >= ALMOST_FULL_RATE)
    .sort((a, b) => b.enrolled / (b.maxCapacity ?? 1) - a.enrolled / (a.maxCapacity ?? 1));

  return (
    <section className="flex w-full min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Title order={1} fz="xl">
            Bonjour {firstName}
          </Title>
          <Text size="sm" c="dimmed">
            Saison {season.label}
          </Text>
        </div>
        <div className="flex gap-2">
          {role !== "teacher" && <ButtonLink href="/eleves/nouveau">Nouvel élève</ButtonLink>}
          <ButtonLink href="/planning" variant="default">
            Voir le planning
          </ButtonLink>
        </div>
      </div>

      <Paper
        withBorder
        component="dl"
        className={`grid divide-x divide-bordure ${role === "director" ? "grid-cols-3" : "grid-cols-2"}`}
      >
        <div className="px-3 py-3 sm:px-4">
          <Text component="dt" size="xs" c="dimmed">
            Inscriptions
          </Text>
          <dd className="text-lg font-semibold tabular-nums sm:text-2xl">{digits.enrollments}</dd>
        </div>
        <div className="px-3 py-3 sm:px-4">
          <Text component="dt" size="xs" c="dimmed">
            Danseurs inscrits
          </Text>
          <dd className="text-lg font-semibold tabular-nums sm:text-2xl">{digits.students}</dd>
        </div>
        {role === "director" && (
          <div className="px-3 py-3 sm:px-4">
            <Text component="dt" size="xs" c="dimmed">
              Montant inscrit
            </Text>
            <dd className="text-lg font-semibold tabular-nums sm:text-2xl">{formatEuros(digits.netTotalCents)}</dd>
          </div>
        )}
      </Paper>

      <section aria-labelledby="jour" className="flex flex-col gap-2">
        <Title order={2} size="h5" id="jour">
          Séances du jour
        </Title>
        {ofDay.length > 0 && (
          <Text size="sm" c="dimmed">
            {ofDay.filter((s) => s.status !== "cancelled" && !s.doneAttendance).length} appel(s) à faire ·{" "}
            {ofDay.filter((s) => s.status !== "cancelled" && s.doneAttendance).length} fait(s) ·{" "}
            {ofDay.filter((s) => s.status === "cancelled").length} séance(s) annulée(s)
          </Text>
        )}
        {ofDay.length === 0 ? (
          <Text size="sm" c="dimmed">
            Pas de cours aujourd’hui.
          </Text>
        ) : (
          <Paper withBorder component="ul" className="divide-y divide-bordure text-sm">
            {ofDay.map((s) => (
              <li
                key={s.id}
                className={`flex flex-wrap items-baseline gap-x-3 px-3 py-2 ${s.status === "cancelled" ? "text-doux" : ""}`}
              >
                <span className="w-12 tabular-nums">{s.startTime}</span>
                <span className={`font-medium ${s.status === "cancelled" ? "line-through" : ""}`}>
                  {s.discipline}
                  {s.level && ` ${s.level}`}
                </span>
                <span className="text-doux">
                  {s.room}, {s.instructor}
                </span>
                {s.doneAttendance || s.status === "cancelled" ? (
                  <TextLink href={`/planning/seances/${s.id}`} size="sm" c="dimmed" className="ml-auto">
                    {s.status === "cancelled" ? "Annulée" : "Appel fait"}
                  </TextLink>
                ) : (
                  <ButtonLink href={`/planning/seances/${s.id}`} variant="default" size="xs" className="ml-auto">
                    Faire l’appel
                  </ButtonLink>
                )}
              </li>
            ))}
          </Paper>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="dernieres" className="flex flex-col gap-2">
          <Title order={2} size="h5" id="dernieres">
            Dernières inscriptions
          </Title>
          {latest.length === 0 ? (
            <Text size="sm" c="dimmed">
              Aucune inscription pour l’instant. Recherchez une personne pour commencer.
            </Text>
          ) : (
            <Paper withBorder className="overflow-x-auto">
              <Table>
                <TableThead>
                  <TableTr>
                    <TableTh scope="col">Payeur</TableTh>
                    <TableTh scope="col">Danseur</TableTh>
                    <TableTh scope="col" ta="right">
                      Prix
                    </TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {latest.map((d) => (
                    <TableTr key={d.id}>
                      <TableTd>
                        <TextLink href={`/personnes/${d.payerId}`} size="sm">
                          {d.payer}
                        </TextLink>
                      </TableTd>
                      <TableTd>{d.students}</TableTd>
                      <TableTd ta="right" className="tabular-nums">
                        {formatEuros(d.netPriceCents)}
                      </TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            </Paper>
          )}
        </section>

        <section aria-labelledby="complets" className="flex flex-col gap-2">
          <Title order={2} size="h5" id="complets">
            Cours presque complets
          </Title>
          {almostFull.length === 0 ? (
            <Text size="sm" c="dimmed">
              Tous les cours ont encore de la place.
            </Text>
          ) : (
            <Paper withBorder className="overflow-x-auto">
              <Table>
                <TableThead>
                  <TableTr>
                    <TableTh scope="col">Cours</TableTh>
                    <TableTh scope="col">Créneau</TableTh>
                    <TableTh scope="col" ta="right">
                      Occupation
                    </TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {almostFull.map((c) => (
                    <TableTr key={c.id}>
                      <TableTd>
                        <TextLink href={`/planning/cours/${c.id}`} size="sm">
                          {c.discipline}
                        </TextLink>
                      </TableTd>
                      <TableTd>
                        {c.weekday ? DAYS[c.weekday] : "stage"} {c.startTime}
                      </TableTd>
                      <TableTd ta="right" className="tabular-nums">
                        {c.enrolled} / {c.maxCapacity}
                        <Text span size="xs" c="dimmed" className="block">
                          {c.enrolled >= (c.maxCapacity ?? 0)
                            ? "Complet"
                            : `${(c.maxCapacity ?? 0) - c.enrolled} place(s) restante(s)`}
                        </Text>
                      </TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            </Paper>
          )}
        </section>
      </div>
    </section>
  );
}
