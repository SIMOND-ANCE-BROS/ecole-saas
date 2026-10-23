import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withSchool } from "@/db";
import { scheduleReferential } from "@/db/courses";
import { lessonAvailabilities } from "@/db/unavailabilities";
import { readAttendance } from "@/db/lessons";
import { ageAt } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { end } from "../../format";
import { AttendanceRecord } from "./attendance-record";

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
  const donnees = await withSchool(schoolId, async (tx) => {
    const attendance = await readAttendance(tx, id);
    if (!attendance) return null;
    const { instructors: instructors } = await scheduleReferential(tx, attendance.instructorId);
    const availability = await lessonAvailabilities(tx, attendance.id);
    const ranking = new Map(availability?.substitutes.map((r, rank) => [r.id, { ...r, rank: rank }]));
    // The lesson's instructor first, then available substitutes, then the others with their reason.
    const options = instructors
      .map((i) => {
        const r = ranking.get(i.id);
        const state =
          i.id === attendance.instructorId ? "" : r?.free ? " (libre)" : r?.pattern ? ` (${r.pattern})` : "";
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
      instructors: options,
      unavailable: availability?.unavailable ?? false,
      free: availability?.substitutes.filter((r) => r.free).length ?? 0,
    };
  });
  if (!donnees) notFound();
  const { attendance: attendance, instructors: instructors, unavailable: unavailable, free: free } = donnees;
  const date = longDate.format(new Date(`${attendance.date}T00:00:00Z`));

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <Link href="/planning" className="lien">
          Planning
        </Link>
        <span className="text-doux"> / </span>
        <Link href={`/planning/cours/${attendance.courseId}`} className="lien">
          {attendance.discipline}
        </Link>
        <span className="text-doux"> / Appel du {date}</span>
      </nav>
      <div>
        <h1 className="titre-page">
          Appel : {attendance.discipline}
          {attendance.level && <span className="font-normal text-doux"> {attendance.level}</span>}
        </h1>
        <p className="text-sm first-letter:uppercase">
          {date}, {attendance.startTime}–{end(attendance.startTime, attendance.durationMinutes)}, {attendance.room}
        </p>
      </div>
      {unavailable && attendance.status !== "annulee" && (
        <p role="alert" className="rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">
          L’intervenant de cette séance est indisponible.{" "}
          {free > 0
            ? `${free} remplaçant${free > 1 ? "s" : ""} libre${free > 1 ? "s" : ""} en tête de la liste « Intervenant de la séance ».`
            : "Aucun autre intervenant n’est libre à cette heure."}
        </p>
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
    </section>
  );
}
