"use client";

import {
  Alert,
  Anchor,
  Button,
  Checkbox,
  Fieldset,
  Radio,
  Text,
  Textarea,
  TextInput,
  type TextInputProps,
} from "@mantine/core";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ageAt, isMinor } from "@/domain/people/age";
import { type Choice, PersonChoice, toInput } from "../../_people/person-choice";
import { createStudentFromGuide, type StudentRefusal } from "../actions";
import { Cancel } from "@/app/(espace)/_panel/panel";
import { DateField, refusedDateField } from "@/app/(espace)/_ui/date-field";
import type { DuplicateWithRole, StudentInput } from "@/db/students";
import type { PersonInput } from "@/db/people";
import type { FieldErrors, FieldPath } from "@/lib/form-errors";
import { has } from "@/lib/has";
import { ofName } from "@/lib/french";

/** Checked against the server schema: a value renamed on one side fails to compile. */
type Billing = StudentInput["billing"]["type"];

/** Who a likely duplicate would be, as written in the warning. */
const DUPLICATE_ROLE: Record<DuplicateWithRole["role"], string> = {
  student: "élève",
  guardian: "responsable",
  payer: "payeur",
};

/**
 * New student in a single entry: identity; if a minor, their guardian
 * (known or new) and whether to notify them; then whom to invoice.
 */
export function NewStudentGuide({
  today,
  initialGuardian,
}: {
  today: string;
  initialGuardian?: { id: string; name: string };
}) {
  const [e, setE] = useState({ firstName: "", name: "", birthDate: "", telephone: "", email: "", notes: "" });
  const [withGuardian, setWithGuardian] = useState<boolean | null>(initialGuardian ? true : null);
  const [guardian, setGuardian] = useState<Choice | null>(initialGuardian ?? null);
  const [toNotify, setToNotify] = useState(true);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [payer, setPayer] = useState<Choice | null>(null);
  const [refusal, setRefusal] = useState<StudentRefusal | null>(null);
  const [sending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  // Control to focus once a guardian choice is drawn: the link clicked has gone.
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const selector = focusNext.current;
    if (!selector) return;
    focusNext.current = null;
    form.current?.querySelector<HTMLElement>(selector)?.focus();
  });
  const showGuardian = (shown: boolean) => {
    // The guardian block comes back as it was left: search, new person, or a person picked.
    focusNext.current = shown
      ? "#responsable-cherche, #responsable-firstName, #responsable-change"
      : "[data-no-guardian] button";
    setWithGuardian(shown);
  };
  useEffect(() => {
    if (refusal) form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [refusal]);

  const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(e.birthDate) ? e.birthDate : null;
  const age = birthDate ? ageAt(birthDate, today) : null;
  const minor = isMinor(birthDate, today);
  // By default: a minor has a guardian who pays; an adult pays for themself. A minor always
  // has the guardian block, even if « Pas de responsable » was chosen before the date.
  const displayedGuardian = minor || (withGuardian ?? false);
  const chosenBilling: Billing = billing ?? (displayedGuardian ? "guardian" : "self");
  const firstName = e.firstName.trim() || "l’élève";
  const guardianName = guardian
    ? has(guardian, "id")
      ? guardian.name
      : [guardian.newPerson.firstName, guardian.newPerson.name].filter(Boolean).join(" ") || "le responsable"
    : "le responsable";

  const updated = (field: keyof typeof e) => (x: { currentTarget: { value: string } }) =>
    setE({ ...e, [field]: x.currentTarget.value });
  const error = (key: FieldPath<StudentInput>) => refusal?.errors[key];
  // Errors of a person sub-form (`guardian.newPerson.`), keyed by the person field.
  const sous = (prefix: `${FieldPath<StudentInput>}.`): FieldErrors<PersonInput> =>
    Object.fromEntries(
      Object.entries(refusal?.errors ?? {}).flatMap(([k, v]) =>
        k.startsWith(prefix) ? [[k.slice(prefix.length), v]] : [],
      ),
    );

  const send = (confirmed: boolean) =>
    startTransition(async () =>
      setRefusal(
        await createStudentFromGuide(
          {
            student: { type: "individual", companyName: "", siren: "", address: "", ...e },
            guardian: displayedGuardian && guardian ? toInput(guardian) : null,
            toNotify,
            billing:
              chosenBilling === "other"
                ? { type: "other", payer: payer ? toInput(payer) : null }
                : { type: chosenBilling },
          },
          confirmed,
        ),
      ),
    );

  const field = (
    key: keyof typeof e,
    label: string,
    props: Pick<TextInputProps, "autoFocus" | "inputMode" | "type"> = {},
  ) => (
    <TextInput
      id={key}
      label={label}
      autoComplete="off"
      value={e[key]}
      onChange={updated(key)}
      error={error(`student.${key}`)}
      {...props}
    />
  );

  return (
    <form
      ref={form}
      className="flex w-full min-w-0 flex-col gap-5"
      noValidate
      onSubmit={(x) => {
        x.preventDefault();
        if (refusedDateField(x.currentTarget)) return;
        send(false);
      }}
    >
      <Fieldset legend="1. L’élève">
        <div className="grid items-start gap-3 sm:grid-cols-3">
          {field("firstName", "Prénom", { autoFocus: true })}
          {field("name", "Nom")}
          <div className="flex flex-col gap-1">
            <DateField
              id="birthDate"
              label="Date de naissance"
              maxDate={today}
              value={e.birthDate}
              onChange={(d) => setE({ ...e, birthDate: d })}
              error={error("student.birthDate")}
            />
            {/* Right under the date it comes from, also at phone width. */}
            <Text size="xs" c="dimmed" aria-live="polite">
              {age !== null && (minor ? `${age} ans : mineur, un responsable est demandé.` : `${age} ans.`)}
            </Text>
          </div>
          {field("telephone", "Téléphone (facultatif)", { type: "tel", inputMode: "tel" })}
          {field("email", "E-mail (facultatif)", { type: "email" })}
          <Textarea
            id="notes"
            label="Santé, allergies, consignes (facultatif)"
            className="sm:col-span-3"
            autosize
            minRows={2}
            value={e.notes}
            onChange={updated("notes")}
          />
        </div>
      </Fieldset>

      <Fieldset legend="2. Son responsable" className="flex flex-col gap-3">
        {displayedGuardian ? (
          <>
            <PersonChoice
              id="responsable"
              label={`Qui est le responsable légal ${ofName(firstName)} (parent, tuteur) ?`}
              value={guardian}
              onChange={(c) => {
                // New person: same family name suggested once, when it is created.
                const created = c && has(c, "newPerson") && !(guardian && has(guardian, "newPerson"));
                setGuardian(
                  created && !c.newPerson.name && !c.newPerson.firstName
                    ? { newPerson: { ...c.newPerson, name: e.name } }
                    : c,
                );
              }}
              errors={sous("guardian.newPerson.")}
              flagMinors
            />
            <Checkbox
              label="À prévenir en cas d’urgence"
              checked={toNotify}
              onChange={(x) => setToNotify(x.currentTarget.checked)}
            />
            {!minor && (
              <Anchor
                component="button"
                type="button"
                size="sm"
                className="self-start"
                onClick={() => showGuardian(false)}
              >
                Pas de responsable
              </Anchor>
            )}
          </>
        ) : (
          <Text size="sm" c="dimmed" className="flex flex-wrap items-center gap-2" data-no-guardian>
            {/* No date yet: whether a guardian is needed is not known. */}
            {age === null
              ? "Un responsable est demandé pour un élève mineur : indiquez sa date de naissance."
              : "Pas de responsable pour un élève majeur."}
            <Anchor component="button" type="button" size="sm" onClick={() => showGuardian(true)}>
              {age === null ? "Ajouter un responsable" : "En ajouter un quand même"}
            </Anchor>
          </Text>
        )}
      </Fieldset>

      <Fieldset legend="3. À qui facturer ?" className="flex flex-col gap-2">
        {(
          [
            ["self", `À ${firstName}`, !minor],
            ["guardian", `Au responsable${guardian ? ` (${guardianName})` : ""}`, displayedGuardian],
            ["other", "À un autre payeur : CSE, entreprise, proche…", true],
          ] as const
        )
          .filter(([, , visible]) => visible)
          .map(([value, label]) => (
            <Radio
              key={value}
              name="facturation"
              label={label}
              checked={chosenBilling === value}
              onChange={() => setBilling(value)}
            />
          ))}
        {chosenBilling === "other" && (
          <PersonChoice
            id="payeur"
            label="Quel payeur ?"
            value={payer}
            onChange={setPayer}
            organization
            errors={sous("billing.payer.newPerson.")}
          />
        )}
        {error("billing") && (
          <Text size="xs" c="red">
            {error("billing")}
          </Text>
        )}
        <Text size="xs" c="dimmed">
          Les frères et sœurs facturés à la même personne bénéficient de la réduction fratrie.
        </Text>
      </Fieldset>

      {refusal?.duplicates ? (
        <Alert tabIndex={-1} role="alert" color="yellow">
          <div className="flex flex-col gap-2 text-sm">
            <Text size="sm" fw={500}>
              {refusal.message} Vérifiez avant de créer un doublon :
            </Text>
            <ul className="flex flex-col gap-0.5">
              {refusal.duplicates.map((d) => (
                <li key={`${d.role}-${d.id}`}>
                  {DUPLICATE_ROLE[d.role]} :{" "}
                  <Anchor component={Link} href={`/personnes/${d.id}`} size="sm" target="_blank">
                    {d.name}
                  </Anchor>
                  {d.telephone && <span className="tabular-nums">, {d.telephone}</span>}
                </li>
              ))}
            </ul>
            <Text size="sm">Pour réutiliser une personne existante, cherchez-la dans le champ correspondant.</Text>
            <Button variant="default" className="self-start" disabled={sending} onClick={() => send(true)}>
              Créer quand même
            </Button>
          </div>
        </Alert>
      ) : (
        refusal && (
          <Text tabIndex={-1} role="alert" size="sm" c="red">
            {refusal.message}
          </Text>
        )
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-bordure pt-4">
        <Button type="submit" loading={sending}>
          Créer l’élève
        </Button>
        <Cancel href="/eleves" />
      </div>
    </form>
  );
}
