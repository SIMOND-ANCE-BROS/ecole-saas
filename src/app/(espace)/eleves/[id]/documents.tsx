"use client";

import { Alert, Button, Checkbox, Group, Paper, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useRef, useState, useTransition } from "react";
import type { StudentDocumentRow } from "@/db/student-documents";
import {
  DOCUMENT_LABELS,
  type DocumentState,
  type DocumentToBring,
  type RequirableType,
  validUntilFor,
} from "@/domain/people/documents";
import { settle, type ActionResult } from "@/lib/action-result";
import { frenchList } from "@/lib/french-list";
import { ConfirmRemoval, type Removal } from "../../_ui/confirm-removal";
import { DateField, refusedDateField } from "../../_ui/date-field";
import { TextLink } from "../../_ui/text-link";
import { useFocusAfter } from "../../_ui/use-focus-after";
import { useUnloadGuard, useUnsavedInput } from "../../_ui/unsaved-input";
import { dayOf, WARNING } from "../../_people/sections";
import { editDocument, receiveDocumentToday, unreceiveDocument } from "./document-actions";

/** One document type on the record: what the school asks, what was handed in. */
export type DocumentLine = {
  type: RequirableType;
  /** Asked of this student (school setting, age). */
  expected: boolean;
  state: DocumentState;
  doc: StudentDocumentRow | null;
  /** Still to bring this season: due date, overdue or not. */
  due: DocumentToBring | null;
  /** The school's validity for this type, to suggest an end date. */
  validityMonths: number | null;
};

type Props = {
  studentId: string;
  firstName: string;
  lines: DocumentLine[];
  /** Enrolled in the current season (active or trial): required documents are then due. */
  enrolled: boolean;
  today: string;
  /** Management sees where the requirements are set. */
  isDirector: boolean;
};

type Edition = {
  type: RequirableType;
  receivedOn: string;
  validUntil: string;
  granted: boolean;
  validTouched: boolean;
};

/** What the row says about the document, in words (never by colour alone). */
function status(line: DocumentLine, enrolled: boolean): { text: string; warn: boolean } {
  const d = line.doc;
  const received = d?.receivedOn ? `reçu le ${dayOf(d.receivedOn)}` : "reçu (date inconnue)";
  const due = line.due ? `à fournir avant le ${dayOf(line.due.dueOn)}${line.due.overdue ? ", en retard" : ""}` : null;
  switch (line.state) {
    case "missing":
      if (due) return { text: `Non reçu : ${due}`, warn: line.due?.overdue ?? false };
      return line.expected && !enrolled
        ? { text: "Non reçu, à demander à l’inscription", warn: false }
        : { text: "Non reçu (pas demandé)", warn: false };
    case "expired":
      // `validUntil` is set: an expired document has an end date.
      return {
        text: `Expiré le ${dayOf(d?.validUntil ?? "")}${due ? ` : ${due}` : `, ${received}`}`,
        warn: line.due?.overdue ?? true,
      };
    case "refused":
      return { text: `Refusé par la famille, réponse ${received}`, warn: true };
    case "received": {
      const until = d?.validUntil ? `, valable jusqu’au ${dayOf(d.validUntil)}` : "";
      return { text: `${received.charAt(0).toUpperCase()}${received.slice(1)}${until}`, warn: false };
    }
  }
}

/**
 * « Documents » section of the student record (#287): for each document the
 * school can ask for, whether it was handed in, when, and until when it is
 * valid. One click records it as received today; « Modifier » corrects the
 * dates or the family's answer. Front desk and management.
 */
export function Documents({ studentId, firstName, lines, enrolled, today, isDirector }: Props) {
  const toBring = lines.flatMap((l) => (l.due ? [l.due] : []));
  const overdue = toBring.some((d) => d.overdue);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [inProgress, startTransition] = useTransition();
  const focusAfter = useFocusAfter();
  const form = useRef<HTMLFormElement>(null);
  // A correction being typed is not lost to a reload or a closed tab (#258).
  const holdsInput = useUnsavedInput(form, { enabled: edition !== null });
  useUnloadGuard(holdsInput, { enabled: edition !== null });

  // A refusal or a lost connection keeps what was typed, with its message (#243).
  const act = (action: () => Promise<ActionResult>, after?: () => void, failed?: () => void) =>
    startTransition(async () => {
      const r = await settle(action);
      setMessage(r.ok ? null : r.message);
      if (r.ok) after?.();
      else failed?.();
    });

  const closeEdit = (type: RequirableType) => {
    focusAfter(`[data-document-edit="${type}"]`);
    setEdition(null);
  };
  const open = (line: DocumentLine) => {
    setMessage(null);
    const receivedOn = line.doc?.receivedOn ?? today;
    setEdition({
      type: line.type,
      receivedOn,
      validUntil: line.doc ? (line.doc.validUntil ?? "") : (validUntilFor(receivedOn, line.validityMonths) ?? ""),
      granted: line.doc?.granted ?? true,
      validTouched: line.doc !== null,
    });
  };
  const done = (message: string) => notifications.show({ color: "green", message });
  const validityOf = (type: RequirableType) => lines.find((l) => l.type === type)?.validityMonths ?? null;

  return (
    <section aria-labelledby="documents" className="flex flex-col gap-2">
      <ConfirmRemoval removal={removal} onClose={() => setRemoval(null)} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <Title order={2} size="h5" id="documents" tabIndex={-1}>
          Documents
        </Title>
        {isDirector && (
          <TextLink href="/parametres/documents" size="sm">
            Documents demandés par l’école
          </TextLink>
        )}
      </div>
      {toBring.length > 0 && (
        <Alert
          color={overdue ? "yellow" : "blue"}
          title={overdue ? "Documents en retard" : "Documents à fournir"}
          role="status"
        >
          <Text size="sm">
            Pour {firstName} :{" "}
            {frenchList(
              toBring.map(
                (d) =>
                  `${DOCUMENT_LABELS[d.type].toLowerCase()} avant le ${dayOf(d.dueOn)}${d.overdue ? " (en retard)" : ""}`,
              ),
            )}
            . L’inscription reste valable.
          </Text>
        </Alert>
      )}
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
      {lines.length === 0 && (
        <Text size="sm" c="dimmed">
          L’école ne demande aucun document à {firstName}.
        </Text>
      )}
      <Paper
        withBorder
        component="ul"
        aria-label="Documents"
        className="divide-y divide-bordure text-sm"
        hidden={lines.length === 0}
      >
        {lines.map((line) => {
          const label = DOCUMENT_LABELS[line.type];
          const s = status(line, enrolled);
          const editing = edition?.type === line.type;
          const toReceive = line.state === "missing" || line.state === "expired";
          return (
            <li key={line.type} className="flex flex-col gap-2 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{label}</span>
                <Text span size="sm" c={s.warn ? WARNING : "dimmed"} fw={s.warn ? 500 : undefined}>
                  {s.text}
                </Text>
                {!editing && (
                  <Group gap="xs" className="ml-auto">
                    {toReceive && (
                      <Button
                        size="compact-sm"
                        variant="default"
                        disabled={inProgress}
                        aria-label={`${label} : reçu aujourd’hui`}
                        data-document-receive={line.type}
                        onClick={() =>
                          act(
                            () => receiveDocumentToday(studentId, line.type),
                            () => {
                              done(`${label} : reçu aujourd’hui.`);
                              focusAfter(`[data-document-edit="${line.type}"]`);
                            },
                          )
                        }
                      >
                        Reçu aujourd’hui
                      </Button>
                    )}
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      disabled={inProgress}
                      aria-label={`Modifier : ${label}`}
                      data-document-edit={line.type}
                      onClick={() => open(line)}
                    >
                      Modifier
                    </Button>
                    {line.doc && (
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        color="red"
                        disabled={inProgress}
                        aria-label={`Retirer : ${label}`}
                        data-document-remove={line.type}
                        onClick={() =>
                          setRemoval({
                            title: `Retirer : ${label} ?`,
                            body: `${label} redevient « non reçu » pour ${firstName}. Le journal garde ce qui était enregistré.`,
                            run: () =>
                              act(
                                () => unreceiveDocument(studentId, line.type),
                                () => {
                                  done(`${label} : retiré.`);
                                  focusAfter(
                                    `[data-document-receive="${line.type}"]`,
                                    `[data-document-edit="${line.type}"]`,
                                  );
                                },
                                () => focusAfter(`[data-document-remove="${line.type}"]`),
                              ),
                          })
                        }
                      >
                        Retirer
                      </Button>
                    )}
                  </Group>
                )}
              </div>
              {editing && edition && (
                <form
                  ref={form}
                  aria-label={`Modifier : ${label}`}
                  className="flex flex-wrap items-end gap-3"
                  onKeyDown={(e) => e.key === "Escape" && closeEdit(line.type)}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (refusedDateField(e.currentTarget)) return;
                    act(
                      () =>
                        editDocument(studentId, {
                          type: edition.type,
                          receivedOn: edition.receivedOn,
                          validUntil: edition.validUntil || null,
                          granted: edition.granted,
                        }),
                      () => {
                        done(`${label} : enregistré.`);
                        closeEdit(line.type);
                      },
                    );
                  }}
                >
                  <DateField
                    label="Reçu le"
                    required
                    autoFocus
                    maxDate={today}
                    value={edition.receivedOn}
                    onChange={(receivedOn) =>
                      setEdition(
                        (x) =>
                          x && {
                            ...x,
                            receivedOn,
                            // The end date follows the date received until it is typed by hand.
                            validUntil:
                              x.validTouched || !receivedOn
                                ? x.validUntil
                                : (validUntilFor(receivedOn, validityOf(x.type)) ?? ""),
                          },
                      )
                    }
                    className="w-40"
                  />
                  <DateField
                    label="Valable jusqu’au"
                    description="Vide : sans limite"
                    minDate={edition.receivedOn || undefined}
                    value={edition.validUntil}
                    onChange={(validUntil) => setEdition((x) => x && { ...x, validUntil, validTouched: true })}
                    className="w-40"
                  />
                  {line.type !== "medical_certificate" && (
                    <Checkbox
                      label="Accordé par la famille"
                      checked={edition.granted}
                      onChange={(e) => {
                        const granted = e.currentTarget.checked;
                        setEdition((x) => x && { ...x, granted });
                      }}
                      className="pb-2"
                    />
                  )}
                  <Group gap="xs">
                    <Button type="submit" size="compact-sm" loading={inProgress}>
                      Enregistrer
                    </Button>
                    <Button
                      type="button"
                      size="compact-sm"
                      variant="subtle"
                      color="gray"
                      onClick={() => closeEdit(line.type)}
                    >
                      Annuler
                    </Button>
                  </Group>
                </form>
              )}
            </li>
          );
        })}
      </Paper>
    </section>
  );
}
