"use client";

import { Button, Group, NativeSelect, Paper, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useRef, useState, useTransition } from "react";
import { settle, type ActionResult } from "@/lib/action-result";
import { ConfirmRemoval, type Removal } from "../_ui/confirm-removal";
import { DateField, refusedDateField } from "../_ui/date-field";
import { useEscapeCancels } from "../_ui/escape-asks";
import { TextLink } from "../_ui/text-link";
import { useFocusAfter } from "../_ui/use-focus-after";
import { useUnloadGuard } from "../_ui/unsaved-input";
import { chooseReferral, markPhotos, signRules, unsignRules } from "./rules-actions";
import { dayOf, WARNING } from "./sections";
import { REFERRAL_UNANSWERED } from "@/domain/people/internal-rules";

/** One payer of the season and the internal rules. */
export type RulesLine = {
  payerId: string;
  payerName: string;
  /** Pays an active or trial enrollment and the school recorded the season's rules: missing until signed. */
  enrolled: boolean;
  acceptedOn: string | null;
  /** The date offered: the payer's enrollment date, else today (`defaultAcceptedOn`). */
  defaultOn: string;
  /** Signed before the school changed the season's rules. */
  olderVersion: boolean;
};

/** What only the student record shows: photos and « Comment nous avez-vous connus ? ». */
export type StudentChoices = {
  studentId: string;
  refusesPhotos: boolean;
  referralId: string | null;
  referrals: { id: string; label: string }[];
};

type Props = {
  /** The season the record shows (#362): its rules are signed or withdrawn. */
  season: { id: string; label: string };
  lines: RulesLine[];
  /** The school recorded the season's rules: only then are signatures collected. */
  rulesRecorded: boolean;
  today: string;
  /** Payer record: lines say « Signé » without naming the payer, who is the record. */
  ownRecord?: boolean;
  student?: StudentChoices;
  /** Management sees where the rules text and the answers are set. */
  isDirector: boolean;
};

const done = (message: string) => notifications.show({ color: "green", message });

/**
 * « Règlement intérieur » section (#296): whether each payer of the season
 * signed the rules, on which day; on a student record, the family's refusal
 * of photos and the answer to « Comment nous avez-vous connus ? ». Signing on
 * the enrollment day is one click; another day opens a date field.
 */
export function RulesSection({ season, lines, rulesRecorded, today, ownRecord = false, student, isDirector }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [inProgress, startTransition] = useTransition();
  // The answer chosen here, until the page reloads with it; null: the recorded one.
  const [referral, setReferral] = useState<string | null>(null);
  const focusAfter = useFocusAfter();

  // A refusal or a lost connection shows its message; a date being typed stays in its form (#243).
  const act = (action: () => Promise<ActionResult>, after?: () => void) =>
    startTransition(async () => {
      const r = await settle(action);
      setMessage(r.ok ? null : r.message);
      if (r.ok) after?.();
    });
  const closeEdit = (payerId: string) => {
    focusAfter(`[data-rules-edit="${payerId}"]`);
    setEditing(null);
    setMessage(null);
  };
  const who = (l: RulesLine) => (ownRecord ? "" : ` par ${l.payerName}`);

  return (
    <section aria-labelledby="reglement" className="flex flex-col gap-2">
      <ConfirmRemoval removal={removal} onClose={() => setRemoval(null)} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <Title order={2} size="h5" id="reglement" tabIndex={-1}>
          Règlement intérieur {season.label}
        </Title>
        {isDirector && (
          <TextLink href="/parametres/inscription" size="sm">
            Texte du règlement et réponses proposées
          </TextLink>
        )}
      </div>
      <Paper withBorder component="ul" aria-label="Règlement intérieur" className="divide-y divide-bordure text-sm">
        {lines.length === 0 && (
          <li className="px-3 py-2.5">
            <Text span size="sm" c="dimmed">
              Pas encore d’inscription cette saison : le règlement se signe avec la fiche d’inscription.
            </Text>
          </li>
        )}
        {lines.map((l) => {
          const signed = l.acceptedOn !== null;
          const warn = !signed && l.enrolled;
          // No rules recorded for the season: nothing to sign (a signature already recorded stays).
          if (!signed && !rulesRecorded)
            return (
              <li key={l.payerId} className="px-3 py-2.5">
                <Text span size="sm" c="dimmed">
                  Aucun règlement enregistré pour la saison : pas de signature à recueillir.
                </Text>
              </li>
            );
          return (
            <li key={l.payerId} className="flex flex-col gap-2 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{signed ? `Signé${who(l)}` : `Non signé${who(l)}`}</span>
                <Text span size="sm" c={warn ? WARNING : "dimmed"} fw={warn ? 500 : undefined}>
                  {signed
                    ? `le ${dayOf(l.acceptedOn ?? "")}${l.olderVersion ? ", version précédente du règlement" : ""}`
                    : warn
                      ? "à faire signer"
                      : "à signer à l’inscription"}
                </Text>
                {editing !== l.payerId && (
                  <Group gap="xs" className="ml-auto">
                    {!signed && (
                      <Button
                        size="compact-sm"
                        variant="default"
                        disabled={inProgress}
                        data-rules-sign={l.payerId}
                        aria-label={`Règlement signé${who(l)} le ${dayOf(l.defaultOn)}`}
                        onClick={() =>
                          act(
                            () => signRules(l.payerId, season.id, l.defaultOn),
                            () => {
                              done("Règlement intérieur : signature enregistrée.");
                              focusAfter(`[data-rules-edit="${l.payerId}"]`);
                            },
                          )
                        }
                      >
                        {l.defaultOn === today ? "Marquer signé aujourd’hui" : `Marquer signé le ${dayOf(l.defaultOn)}`}
                      </Button>
                    )}
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      disabled={inProgress}
                      data-rules-edit={l.payerId}
                      aria-label={signed ? `Modifier la date de signature${who(l)}` : `Signé${who(l)} un autre jour`}
                      onClick={() => {
                        setMessage(null);
                        setEditing(l.payerId);
                      }}
                    >
                      {signed ? "Modifier la date" : "Autre date"}
                    </Button>
                    {signed && (
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        color="red"
                        disabled={inProgress}
                        data-rules-remove={l.payerId}
                        aria-label={`Retirer la signature${who(l)}`}
                        onClick={() =>
                          setRemoval({
                            title: "Retirer la signature du règlement ?",
                            body: `Le règlement repasse à « non signé »${who(l)}. Le journal garde ce qui était enregistré.`,
                            run: () =>
                              act(
                                () => unsignRules(l.payerId, season.id),
                                () => {
                                  done("Règlement intérieur : signature retirée.");
                                  focusAfter(`[data-rules-sign="${l.payerId}"]`);
                                },
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
              {editing === l.payerId && (
                <SignedOnForm
                  initial={l.acceptedOn ?? l.defaultOn}
                  today={today}
                  inProgress={inProgress}
                  message={message}
                  close={() => closeEdit(l.payerId)}
                  save={(on) =>
                    act(
                      () => signRules(l.payerId, season.id, on),
                      () => {
                        done("Règlement intérieur : date de signature enregistrée.");
                        closeEdit(l.payerId);
                      },
                    )
                  }
                />
              )}
            </li>
          );
        })}
        {student && (
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
            <span className="font-medium">Photos et vidéos</span>
            <Text
              span
              size="sm"
              c={student.refusesPhotos ? WARNING : "dimmed"}
              fw={student.refusesPhotos ? 500 : undefined}
            >
              {student.refusesPhotos
                ? "Refusées par la famille"
                : lines.some((l) => l.acceptedOn !== null)
                  ? "Accordées avec le règlement signé"
                  : "Pas de refus noté (règlement non signé)"}
            </Text>
            <Button
              size="compact-sm"
              variant="subtle"
              className="ml-auto"
              disabled={inProgress}
              data-photos
              onClick={() =>
                act(
                  () => markPhotos(student.studentId, !student.refusesPhotos),
                  () => {
                    done(student.refusesPhotos ? "Refus des photos retiré." : "Refus des photos noté.");
                    focusAfter("[data-photos]");
                  },
                )
              }
            >
              {student.refusesPhotos ? "Retirer le refus" : "Noter un refus"}
            </Button>
          </li>
        )}
        {student && (
          <li className="flex flex-col gap-1 px-3 py-2.5">
            {student.referrals.length === 0 ? (
              <Text size="sm" c="dimmed">
                « Comment nous avez-vous connus ? » : aucune réponse proposée par l’école.
              </Text>
            ) : (
              // Chosen, then saved with its button: arrows in a closed select change the value at
              // each key on Windows, so saving on change would record every answer passed by.
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = referral ?? student.referralId ?? "";
                  act(
                    () => chooseReferral(student.studentId, value || null),
                    () => {
                      done("Réponse enregistrée.");
                      setReferral(null);
                    },
                  );
                }}
              >
                <NativeSelect
                  label="Comment nous avez-vous connus ?"
                  size="sm"
                  className="max-w-xs"
                  value={referral ?? student.referralId ?? ""}
                  data={[
                    { value: "", label: REFERRAL_UNANSWERED },
                    ...student.referrals.map((r) => ({ value: r.id, label: r.label })),
                  ]}
                  onChange={(e) => setReferral(e.currentTarget.value)}
                />
                {referral !== null && referral !== (student.referralId ?? "") && (
                  <Button type="submit" size="compact-sm" variant="default" loading={inProgress}>
                    Enregistrer la réponse
                  </Button>
                )}
              </form>
            )}
          </li>
        )}
      </Paper>
      {message && editing === null && (
        <Text role="alert" size="sm" c="red">
          {message}
        </Text>
      )}
    </section>
  );
}

/**
 * The day the rules were signed, mounted with its edit. Escape untouched closes
 * it at once (focus back on the row's button); with a date changed, it asks
 * « Abandonner la saisie ? » first (#343). A reload or a closed tab asks too (#258).
 */
function SignedOnForm({
  initial,
  today,
  inProgress,
  message,
  close,
  save,
}: {
  initial: string;
  today: string;
  inProgress: boolean;
  message: string | null;
  close: () => void;
  save: (on: string) => void;
}) {
  const [on, setOn] = useState(initial);
  const form = useRef<HTMLFormElement>(null);
  const escape = useEscapeCancels(form, close, () => on !== initial);
  useUnloadGuard(escape.holdsInput);
  return (
    <form
      ref={form}
      aria-label="Date de signature du règlement"
      className="flex flex-col gap-2"
      // While saving, Escape does nothing: a refusal must stay on screen with what was typed.
      onKeyDown={(e) => !inProgress && escape.onKeyDown(e)}
      onSubmit={(e) => {
        e.preventDefault();
        if (refusedDateField(e.currentTarget)) return;
        save(on);
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <DateField label="Signé le" required autoFocus maxDate={today} value={on} onChange={setOn} className="w-40" />
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
