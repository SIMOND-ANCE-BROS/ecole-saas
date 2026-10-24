"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import type { Attendance } from "@/db/lessons";
import { cancel, doAttendance, replace } from "../actions";

type Props = {
  attendance: Omit<Attendance, "students"> & { students: (Attendance["students"][number] & { age: number | null })[] };
  instructors: { id: string; name: string }[];
};

/**
 * Keyboard attendance sheet: P or A on a row marks the student and moves to
 * the next one, up and down arrows to move around, Ctrl + Enter saves.
 */
export function AttendanceRecord({ attendance: attendance, instructors: instructors }: Props) {
  const [attendances, setAttendances] = useState<Record<string, boolean | null>>(
    Object.fromEntries(attendance.students.map((d) => [d.id, d.present])),
  );
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [inProgress, startTransition] = useTransition();
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const annulee = attendance.status === "cancelled";

  const unmarked = attendance.students.filter((d) => attendances[d.id] === null).length;
  const presents = attendance.students.filter((d) => attendances[d.id] === true).length;
  const mark = (id: string, present: boolean) => setAttendances((p) => ({ ...p, [id]: present }));
  const go = (i: number) => rows.current[Math.max(0, Math.min(i, attendance.students.length - 1))]?.focus();

  const act = (action: () => Promise<{ message: string | null }>, success: string) =>
    startTransition(async () => {
      const { message: error } = await action();
      setMessage(error ? { text: error, error: true } : { text: success, error: false });
    });
  const save = () =>
    act(
      () =>
        doAttendance(
          attendance.id,
          attendance.students
            .filter((d) => attendances[d.id] !== null)
            .map((d) => ({ studentId: d.id, present: attendances[d.id] as boolean })),
        ),
      "Appel enregistré.",
    );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
      <div
        className="flex flex-col gap-3"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !annulee) {
            e.preventDefault();
            save();
          }
        }}
      >
        {annulee ? (
          <p className="rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">Séance annulée : pas d’appel.</p>
        ) : attendance.students.length === 0 ? (
          <p className="text-sm text-doux">Aucun danseur inscrit ou à l’essai dans ce cours.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <button
                type="button"
                className="bouton-secondaire"
                onClick={() => setAttendances(Object.fromEntries(attendance.students.map((d) => [d.id, true])))}
              >
                Tous présents
              </button>
              <span className="text-doux" aria-live="polite">
                {presents} présent{presents > 1 ? "s" : ""} sur {attendance.students.length}
                {unmarked > 0 && `, ${unmarked} à marquer`}
              </span>
              <span className="ml-auto hidden text-xs text-doux sm:inline">
                P présent, A absent, flèches pour se déplacer
              </span>
            </div>
            <ul className="panneau divide-y divide-bordure" aria-label="Danseurs">
              {attendance.students.map((d, i) => {
                const p = attendances[d.id];
                return (
                  <li
                    key={d.id}
                    ref={(el) => {
                      rows.current[i] = el;
                    }}
                    tabIndex={0}
                    aria-label={`${d.firstName} ${d.name} : ${p === null ? "non marqué" : p ? "présent" : "absent"}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm outline-none focus:bg-accent-doux/50"
                    onKeyDown={(e) => {
                      const key = e.key.toLowerCase();
                      if (key === "p" || key === "a") {
                        e.preventDefault();
                        mark(d.id, key === "p");
                        go(i + 1);
                      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        go(e.key === "ArrowDown" ? i + 1 : i - 1);
                      }
                    }}
                  >
                    <span className="min-w-40 flex-1">
                      <Link href={`/eleves/${d.id}`} className="lien font-medium" tabIndex={-1}>
                        {d.firstName} {d.name}
                      </Link>
                      {d.age !== null && <span className="text-doux"> ({d.age} ans)</span>}
                      {d.status === "trial" && (
                        <span className="ml-2 rounded bg-accent-doux px-1.5 text-xs">à l’essai</span>
                      )}
                      {d.notes && <span className="block text-xs text-alerte-texte">{d.notes}</span>}
                    </span>
                    <span className="flex gap-1" role="group" aria-label={`Présence de ${d.firstName}`}>
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-pressed={p === true}
                        className="rounded-md border border-bordure px-3 py-2 text-sm sm:py-1 aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-sur-accent"
                        onClick={() => mark(d.id, true)}
                      >
                        Présent
                      </button>
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-pressed={p === false}
                        className="rounded-md border border-bordure px-3 py-2 text-sm sm:py-1 aria-pressed:border-alerte-texte aria-pressed:bg-alerte-fond aria-pressed:text-alerte-texte"
                        onClick={() => mark(d.id, false)}
                      >
                        Absent
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="bouton-principal" disabled={inProgress} onClick={save}>
                {inProgress ? "Enregistrement…" : "Enregistrer l’appel"}
              </button>
              <span className="hidden text-xs text-doux sm:inline">ou Ctrl + Entrée</span>
            </div>
          </>
        )}
        {message && (
          <p role={message.error ? "alert" : "status"} className={`text-sm ${message.error ? "text-erreur" : ""}`}>
            {message.text}
          </p>
        )}
      </div>

      <aside className="panneau flex flex-col gap-3 self-start p-3 text-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="intervenant" className="font-medium">
            Intervenant de la séance
          </label>
          <select
            id="intervenant"
            className="champ"
            defaultValue={attendance.instructorId}
            disabled={inProgress}
            onChange={(e) => act(() => replace(attendance.id, e.target.value), "Intervenant de la séance changé.")}
          >
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.id === attendance.regularInstructorId ? " (titulaire)" : ""}
              </option>
            ))}
          </select>
          {attendance.instructorId !== attendance.regularInstructorId && (
            <p className="text-xs text-doux">Remplacement pour cette séance seulement.</p>
          )}
        </div>
        <button
          type="button"
          className="lien self-start text-sm"
          disabled={inProgress}
          onClick={() => act(() => cancel(attendance.id, !annulee), annulee ? "Séance rétablie." : "Séance annulée.")}
        >
          {annulee ? "Rétablir la séance" : "Annuler la séance"}
        </button>
      </aside>
    </div>
  );
}
