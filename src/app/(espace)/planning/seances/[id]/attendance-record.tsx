"use client";

import { Alert, Anchor, Badge, Button, Paper, Select, Text } from "@mantine/core";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
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
  const cancelled = attendance.status === "cancelled";

  // The instructor being saved, shown at once; a refusal goes back to the saved one (#188).
  const [instructorId, setInstructorId] = useState<string | null>(null);
  const [instructorError, setInstructorError] = useState<string | null>(null);
  const shownInstructor = instructorId ?? attendance.instructorId;
  const instructorField = useRef<HTMLInputElement>(null);
  // The field is disabled while saving: once a refusal is shown, focus goes back to it for a retry.
  useEffect(() => {
    if (instructorError && !inProgress) instructorField.current?.focus();
  }, [instructorError, inProgress]);

  // P and A work at once: the first row takes focus, unless the user is already typing somewhere.
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches("input, textarea, select, [contenteditable='true']")) return;
    rows.current[0]?.focus();
  }, []);

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
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !cancelled) {
            e.preventDefault();
            save();
          }
        }}
      >
        {cancelled ? (
          <Alert color="yellow" role="status">
            Séance annulée : pas d’appel.
          </Alert>
        ) : attendance.students.length === 0 ? (
          <Text size="sm" c="dimmed">
            Aucun danseur inscrit ou à l’essai dans ce cours.
          </Text>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Button
                variant="default"
                onClick={() => setAttendances(Object.fromEntries(attendance.students.map((d) => [d.id, true])))}
              >
                Tous présents
              </Button>
              <Text span size="sm" c="dimmed" aria-live="polite">
                {presents} présent{presents > 1 ? "s" : ""} sur {attendance.students.length}
                {unmarked > 0 && `, ${unmarked} à marquer`}
              </Text>
              <span className="ml-auto hidden text-xs text-doux sm:inline">
                P présent, A absent, flèches pour se déplacer
              </span>
            </div>
            <Paper withBorder component="ul" className="divide-y divide-bordure" aria-label="Danseurs">
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
                      <Anchor component={Link} href={`/eleves/${d.id}`} inherit fw={500} tabIndex={-1}>
                        {d.firstName} {d.name}
                      </Anchor>
                      {d.age !== null && <span className="text-doux"> ({d.age} ans)</span>}
                      {d.status === "trial" && (
                        <Badge variant="light" ml="xs">
                          à l’essai
                        </Badge>
                      )}
                      {d.notes && <span className="block text-xs text-alerte-texte">{d.notes}</span>}
                    </span>
                    <span className="flex gap-1" role="group" aria-label={`Présence de ${d.firstName}`}>
                      <Button
                        size="xs"
                        tabIndex={-1}
                        aria-pressed={p === true}
                        variant={p === true ? "filled" : "default"}
                        onClick={() => mark(d.id, true)}
                      >
                        Présent
                      </Button>
                      <Button
                        size="xs"
                        tabIndex={-1}
                        aria-pressed={p === false}
                        variant={p === false ? "light" : "default"}
                        color={p === false ? "yellow" : undefined}
                        onClick={() => mark(d.id, false)}
                      >
                        Absent
                      </Button>
                    </span>
                  </li>
                );
              })}
            </Paper>
            <div className="flex flex-wrap items-center gap-3">
              <Button loading={inProgress} onClick={save}>
                Enregistrer l’appel
              </Button>
              <span className="hidden text-xs text-doux sm:inline">ou Ctrl + Entrée</span>
            </div>
          </>
        )}
        {message && (
          <Text role={message.error ? "alert" : "status"} size="sm" c={message.error ? "red" : undefined}>
            {message.text}
          </Text>
        )}
      </div>

      <Paper withBorder component="aside" p="sm" className="flex flex-col gap-3 self-start text-sm">
        <Select
          ref={instructorField}
          label="Intervenant de la séance"
          allowDeselect={false}
          searchable
          value={shownInstructor}
          disabled={inProgress}
          data={instructors.map((i) => ({
            value: i.id,
            label: `${i.name}${i.id === attendance.regularInstructorId ? " (titulaire)" : ""}`,
          }))}
          onChange={(id) => {
            if (!id || id === shownInstructor) return;
            setInstructorId(id);
            setInstructorError(null);
            startTransition(async () => {
              let error: string | null;
              try {
                error = (await replace(attendance.id, id)).message;
              } catch (e) {
                unstable_rethrow(e);
                error = "Intervenant non enregistré : réessayez.";
              }
              if (error) {
                setInstructorId(null);
                setInstructorError(error);
              } else setMessage({ text: "Intervenant de la séance changé.", error: false });
            });
          }}
          error={instructorError}
          description={
            shownInstructor !== attendance.regularInstructorId ? "Remplacement pour cette séance seulement." : undefined
          }
          inputWrapperOrder={["label", "input", "description", "error"]}
        />
        <Button
          variant="subtle"
          size="compact-sm"
          className="self-start"
          disabled={inProgress}
          onClick={() =>
            act(() => cancel(attendance.id, !cancelled), cancelled ? "Séance rétablie." : "Séance annulée.")
          }
        >
          {cancelled ? "Rétablir la séance" : "Annuler la séance"}
        </Button>
      </Paper>
    </div>
  );
}
