import type { Metadata } from "next";
import { Alert, Text, Title } from "@mantine/core";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { scheduleReferential } from "@/db/courses";
import { lessonAvailabilities } from "@/db/unavailabilities";
import { readAttendance } from "@/db/lessons";
import { ageAt } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { end } from "../../format";
import { TextLink } from "@/app/(espace)/_ui/text-link";
import { AttendanceRecord } from "./attendance-record";
import { PackUsage } from "./pack-usage";
import { lessonPacks } from "@/db/lesson-packs";
import { coursePlanning } from "../../course-planning";

export const metadata: Metadata = { title: "Appel" };

const longDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export default async function AttendancePage({ params }: PageProps<"/planning/seances/[id]">) {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const { id } = await params;
  const parsed = await withSchool(schoolId, async (tx) => {
    const attendance = await readAttendance(tx, id);
    if (!attendance) return null;
    const planning = await coursePlanning(tx, attendance.courseId);
    const { instructors: instructors } = await scheduleReferential(tx, attendance.instructorId);
    const availability = await lessonAvailabilities(tx, attendance.id);
    const ranking = new Map(availability?.substitutes.map((r, rank) => [r.id, { ...r, rank: rank }]));
    // The lesson's instructor first, then available substitutes, then the others with their reason.
    const options = instructors
      .map((i) => {
        const r = ranking.get(i.id);
        const state = i.id === attendance.instructorId ? "" : r?.free ? " (libre)" : r?.reason ? ` (${r.reason})` : "";
        return {
          id: i.id,
          name: `${i.firstName} ${i.name}${state}`,
          rank: i.id === attendance.instructorId ? -1 : (r?.rank ?? 999),
        };
      })
      .sort((a, b) => a.rank - b.rank)
      .map((o) => ({ id: o.id, name: o.name }));
    return {
      attendance: attendance,
      planning,
      instructors: options,
      unavailable: availability?.unavailable ?? false,
      free: availability?.substitutes.filter((r) => r.free).length ?? 0,
      // Private lessons only: the packs it is counted on, and the ones it can be (#286).
      packs:
        attendance.courseType === "private"
          ? await lessonPacks(
              tx,
              attendance.id,
              attendance.students.map((s) => s.id),
            )
          : null,
    };
  });
  if (!parsed) notFound();
  const { attendance: attendance, instructors: instructors, unavailable: unavailable, free: free } = parsed;
  const date = longDate.format(new Date(`${attendance.date}T00:00:00Z`));

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <TextLink href={parsed.planning.href} size="sm">
          {parsed.planning.label}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          /{" "}
        </Text>
        <TextLink href={`/planning/cours/${attendance.courseId}`} size="sm">
          {attendance.discipline}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Appel du {date}
        </Text>
      </nav>
      <div>
        <Title order={1} fz="xl">
          Appel : {attendance.discipline}
          {attendance.level && (
            <Text span inherit fw={400} c="dimmed">
              {" "}
              {attendance.level}
            </Text>
          )}
        </Title>
        <Text size="sm" className="first-letter:uppercase">
          {date}, {attendance.startTime}–{end(attendance.startTime, attendance.durationMinutes)}, {attendance.room}
        </Text>
      </div>
      {unavailable && attendance.status !== "cancelled" && (
        <Alert role="alert" color="yellow">
          L’intervenant de cette séance est indisponible.{" "}
          {free > 0
            ? `${free} remplaçant${free > 1 ? "s" : ""} libre${free > 1 ? "s" : ""} en tête de la liste « Intervenant de la séance ».`
            : "Aucun autre intervenant n’est libre à cette heure."}
        </Alert>
      )}
      <AttendanceRecord
        attendance={{
          ...attendance,
          students: attendance.students.map((d) => ({
            ...d,
            age: d.birthDate ? ageAt(d.birthDate, attendance.date) : null,
          })),
        }}
        instructors={instructors}
      />
      {parsed.packs && (
        <PackUsage lessonId={attendance.id} cancelled={attendance.status === "cancelled"} packs={parsed.packs} />
      )}
    </section>
  );
}
