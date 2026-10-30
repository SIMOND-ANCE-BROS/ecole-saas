"use client";

import { Alert, Button, Checkbox, Group, Paper, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { type Dispatch, type SetStateAction, useRef, useState, useTransition } from "react";
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
import { useEscapeCancels } from "../../_ui/escape-asks";
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
  /** The school's validity for this type; set: the document's own date is asked, its validity runs from it. */
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
  datedOn: string;
  validUntil: string;
  granted: boolean;
  /** The end date was typed by hand: it no longer follows the document's date. */
  validTouched: boolean;
};

/** Feminine names, for the agreement of « reçue », « expirée »… */
const FEMININE: Record<RequirableType, boolean> = {
  medical_certificate: false,
  parental_consent: true,
  image_rights: false,
};
const agreed = (type: RequirableType, participle: string) => `${participle}${FEMININE[type] ? "e" : ""}`;

/** What the row says about the document, in words (never by colour alone). */
function status(line: DocumentLine, enrolled: boolean): { text: string; warn: boolean } {
  const d = line.doc;
  const received = d?.receivedOn
    ? `${agreed(line.type, "reçu")} le ${dayOf(d.receivedOn)}`
    : `${agreed(line.type, "reçu")} (date inconnue)`;
  const dated = d?.datedOn ? `, ${agreed(line.type, "daté")} du ${dayOf(d.datedOn)}` : "";
  const due = line.due ? `à fournir avant le ${dayOf(line.due.dueOn)}${line.due.overdue ? ", en retard" : ""}` : null;
  const notReceived = `Non ${agreed(line.type, "reçu")}`;
  switch (line.state) {
    case "missing":
      if (due) return { text: `${notReceived} : ${due}`, warn: line.due?.overdue ?? false };
      return { text: `${notReceived}${line.expected && !enrolled ? ", à demander à l’inscription" : ""}`, warn: false };
    case "expired":
      // `validUntil` is set: an expired document has an end date.
      return {
        text: `${agreed(line.type, "Expiré")} le ${dayOf(d?.validUntil ?? "")}${due ? ` : ${due}` : `, ${received}`}`,
        warn: line.due?.overdue ?? true,
      };
    case "refused":
      return { text: `Refus de la famille, réponse ${received.replace(/^reçue?/, "reçue")}`, warn: true };
    case "received": {
      const until = d?.validUntil ? `, valable jusqu’au ${dayOf(d.validUntil)}` : "";
      return { text: `${received.charAt(0).toUpperCase()}${received.slice(1)}${dated}${until}`, warn: false };
    }
  }
}

/**
 * « Documents » section of the student record (#287): for each document the
 * school asks of the student, whether it was handed in, when, and until when
 * it is valid. A document without validity is received in one click; one
 * whose validity runs from its own date (the medical certificate) opens the
 * form on that date. Front desk and management.
 */
export function Documents({ studentId, firstName, lines, enrolled, today, isDirector }: Props) {
  const toBring = lines.flatMap((l) => (l.due ? [l.due] : []));
  const overdue = toBring.some((d) => d.overdue);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [inProgress, startTransition] = useTransition();
  const focusAfter = useFocusAfter();

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
    setMessage(null);
  };
  /** Opens the form: the recorded document, or a new one received today (`fresh`). */
  const open = (line: DocumentLine, fresh = false) => {
    setMessage(null);
    const d = fresh ? null : line.doc;
    setEdition({
      type: line.type,
      receivedOn: d?.receivedOn ?? today,
      datedOn: d?.datedOn ?? "",
      validUntil: d?.validUntil ?? "",
      granted: d?.granted ?? true,
      // A recorded end date that is not the one computed from the document's date was typed by hand: kept.
      validTouched:
        d !== null &&
        d.validUntil !== (d.datedOn ? validUntilFor(d.datedOn, line.validityMonths) : null) &&
        !(d.datedOn === null && line.validityMonths !== null),
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
          color={overdue ? "yellow" : "gray"}
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
          const datedType = line.validityMonths !== null;
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
                        aria-label={`${label} : ${agreed(line.type, "reçu")} aujourd’hui`}
                        data-document-receive={line.type}
                        onClick={() =>
                          // Its validity runs from its own date: the form asks for it.
                          datedType
                            ? open(line, true)
                            : act(
                                () => receiveDocumentToday(studentId, line.type),
                                () => {
                                  done(`${label} : ${agreed(line.type, "reçu")} aujourd’hui.`);
                                  focusAfter(`[data-document-edit="${line.type}"]`);
                                },
                              )
                        }
                      >
                        {agreed(line.type, "Reçu")} aujourd’hui
                      </Button>
                    )}
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      disabled={inProgress}
                      aria-label={`${line.doc ? "Modifier" : "Saisir"} : ${label}`}
                      data-document-edit={line.type}
                      onClick={() => open(line)}
                    >
                      {line.doc ? "Modifier" : "Saisir"}
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
                            body: `Le document repasse à « non ${agreed(line.type, "reçu")} » pour ${firstName}. Le journal garde ce qui était enregistré.`,
                            run: () =>
                              act(
                                () => unreceiveDocument(studentId, line.type),
                                () => {
                                  done(`${label} : document retiré.`);
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
                <DocumentForm
                  key={line.type}
                  label={label}
                  recorded={line.doc !== null}
                  datedType={datedType}
                  edition={edition}
                  setEdition={setEdition}
                  today={today}
                  validityOf={validityOf}
                  inProgress={inProgress}
                  message={message}
                  close={() => closeEdit(line.type)}
                  save={() =>
                    act(
                      () =>
                        editDocument(studentId, {
                          type: edition.type,
                          receivedOn: edition.receivedOn,
                          datedOn: edition.datedOn || null,
                          validUntil: edition.validUntil || null,
                          granted: edition.granted,
                        }),
                      () => {
                        done(`${label} : document enregistré.`);
                        closeEdit(line.type);
                      },
                    )
                  }
                />
              )}
            </li>
          );
        })}
      </Paper>
      {message && !edition && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
    </section>
  );
}

/**
 * The form of one document, mounted with its edit: what was typed is checked from a fresh
 * start each time. Escape with the calendar open closes only the calendar; untouched, it
 * closes the form at once (focus back on the row's « Saisir » / « Modifier »); with input,
 * it asks « Abandonner la saisie ? » first (#343, as in settings since #339). A reload or a
 * closed tab asks too (#258).
 */
function DocumentForm({
  label,
  recorded,
  datedType,
  edition,
  setEdition,
  today,
  validityOf,
  inProgress,
  message,
  close,
  save,
}: {
  label: string;
  /** A document is already recorded: « Modifier », else « Saisir ». */
  recorded: boolean;
  /** Its validity runs from its own date, asked first. */
  datedType: boolean;
  edition: Edition;
  setEdition: Dispatch<SetStateAction<Edition | null>>;
  today: string;
  validityOf: (type: RequirableType) => number | null;
  inProgress: boolean;
  message: string | null;
  close: () => void;
  save: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  useUnloadGuard(useUnsavedInput(form));
  const escape = useEscapeCancels(form, close);
  return (
    <form
      ref={form}
      aria-label={`${recorded ? "Modifier" : "Saisir"} : ${label}`}
      className="flex flex-col gap-2"
      onKeyDown={escape.onKeyDown}
      onSubmit={(e) => {
        e.preventDefault();
        if (refusedDateField(e.currentTarget)) return;
        save();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <DateField
          label="Reçu le"
          required
          autoFocus={!datedType}
          maxDate={today}
          value={edition.receivedOn}
          onChange={(receivedOn) => setEdition((x) => x && { ...x, receivedOn })}
          className="w-40"
        />
        {(datedType || edition.datedOn) && (
          <DateField
            label="Daté du"
            required={datedType}
            autoFocus={datedType}
            maxDate={edition.receivedOn || today}
            value={edition.datedOn}
            onChange={(datedOn) =>
              setEdition(
                (x) =>
                  x && {
                    ...x,
                    datedOn,
                    // The end date follows the document's date until it is typed by hand.
                    validUntil:
                      x.validTouched || !datedOn ? x.validUntil : (validUntilFor(datedOn, validityOf(x.type)) ?? ""),
                  },
              )
            }
            className="w-40"
          />
        )}
        <DateField
          label="Valable jusqu’au"
          description="Vide : sans limite"
          minDate={edition.datedOn || edition.receivedOn || undefined}
          value={edition.validUntil}
          onChange={(validUntil) => setEdition((x) => x && { ...x, validUntil, validTouched: true })}
          className="w-40"
        />
        {edition.type !== "medical_certificate" && (
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
          <Button type="submit" size="compact-sm" variant="default" loading={inProgress}>
            Enregistrer
          </Button>
          <Button type="button" size="compact-sm" variant="subtle" color="gray" onClick={close}>
            Annuler
          </Button>
        </Group>
      </div>
      {message && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
      {escape.confirm}
    </form>
  );
}
