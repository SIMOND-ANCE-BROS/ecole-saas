"use client";

import { Alert, Anchor, Button, Fieldset, Radio, Text, Textarea, TextInput, type TextInputProps } from "@mantine/core";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { PersonRecord } from "@/db/people";
import { createContact, updateIdentity, type Refusal } from "./actions";
import { Cancel } from "@/app/(espace)/_panel/panel";
import { DateField, refusedDateField } from "@/app/(espace)/_ui/date-field";

type Props = {
  /** Person being edited; null when creating a contact (a student is created with the guided form). */
  person: Omit<PersonRecord, "relationships" | "courses" | "documents"> | null;
  /** Record we come from: student (birth date and notes) or contact. */
  section: "eleves" | "contacts";
  proposedName?: string;
};

/** Identity and contact details of a student or a contact. */
export function PersonForm({ person: person, section: section, proposedName: proposedName }: Props) {
  const [v, setV] = useState({
    type: person?.type ?? "individual",
    name:
      person?.type === "organisation"
        ? person.name === person.companyName
          ? ""
          : person.name
        : (person?.name ?? proposedName ?? ""),
    firstName: person?.firstName ?? "",
    companyName: person?.companyName ?? "",
    siren: person?.siren ?? "",
    birthDate: person?.birthDate ?? "",
    telephone: person?.telephone ?? "",
    email: person?.email ?? "",
    address: person?.address ?? "",
    notes: person?.notes ?? "",
  });
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [sending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (refusal) form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [refusal]);
  const pro = v.type === "organisation";
  const updated = (field: keyof typeof v) => (e: { currentTarget: { value: string } }) =>
    setV({ ...v, [field]: e.currentTarget.value });

  const entry = {
    ...v,
    companyName: pro ? v.companyName : "",
    siren: pro ? v.siren : "",
    birthDate: pro ? "" : v.birthDate,
  };
  const student = section === "eleves";
  const send = (confirmed: boolean) =>
    startTransition(async () =>
      setRefusal(person ? await updateIdentity(person.id, entry, section) : await createContact(entry, confirmed)),
    );

  const field = (
    name: keyof typeof v,
    label: string,
    props: Pick<TextInputProps, "autoFocus" | "inputMode" | "placeholder" | "type"> = {},
  ) => (
    <TextInput
      id={name}
      label={label}
      autoComplete="off"
      value={v[name]}
      onChange={updated(name)}
      error={refusal?.errors[name]}
      {...props}
    />
  );

  return (
    <form
      ref={form}
      className="flex w-full min-w-0 flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (refusedDateField(e.currentTarget)) return;
        send(false);
      }}
    >
      {!student && (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
          <Text component="legend" size="sm" fw={600} mb={4}>
            Contact
          </Text>
          {(
            [
              ["individual", "Particulier"],
              ["organisation", "Professionnel (entreprise, CSE, association)"],
            ] as const
          ).map(([value, label]) => (
            <Radio
              key={value}
              name="type"
              label={label}
              checked={v.type === value}
              onChange={() => setV({ ...v, type: value })}
            />
          ))}
        </fieldset>
      )}

      <Fieldset legend="Identité">
        {pro ? (
          <div className="grid items-start gap-3 sm:grid-cols-2">
            {field("companyName", "Raison sociale", { autoFocus: !person })}
            {field("siren", "SIREN", { inputMode: "numeric", placeholder: "9 chiffres" })}
            <div className="sm:col-span-2">{field("name", "Contact (facultatif)")}</div>
          </div>
        ) : (
          <div className={`grid items-start gap-3 ${student ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            {field("firstName", "Prénom", { autoFocus: !person })}
            {field("name", "Nom")}
            {student && (
              <DateField
                id="birthDate"
                label="Date de naissance"
                value={v.birthDate}
                onChange={(d) => setV({ ...v, birthDate: d })}
                error={refusal?.errors.birthDate}
              />
            )}
          </div>
        )}
      </Fieldset>
      <Fieldset legend="Coordonnées (facultatives)">
        <div className="grid items-start gap-3 sm:grid-cols-2">
          {field("telephone", "Téléphone", { type: "tel", inputMode: "tel" })}
          {field("email", "E-mail", { type: "email" })}
          <div className="sm:col-span-2">{field("address", "Adresse (pour les factures et attestations)")}</div>
        </div>
      </Fieldset>

      {student && (
        <Textarea
          id="notes"
          label="Notes (santé, allergies, consignes)"
          description="Visibles par l’accueil et la direction. N’y notez que ce qui est utile en cours."
          inputWrapperOrder={["label", "input", "description", "error"]}
          autosize
          minRows={2}
          value={v.notes}
          onChange={updated("notes")}
        />
      )}

      {refusal?.duplicates ? (
        <Alert tabIndex={-1} role="alert" color="yellow">
          <div className="flex flex-col gap-2 text-sm">
            <Text size="sm" fw={500}>
              {refusal.message} Vérifiez avant de créer un doublon :
            </Text>
            <ul className="flex flex-col gap-0.5">
              {refusal.duplicates.map((d) => (
                <li key={d.id}>
                  <Anchor component={Link} href={`/personnes/${d.id}`} size="sm" target="_blank">
                    {d.name}
                  </Anchor>
                  {d.telephone && <span className="tabular-nums">, {d.telephone}</span>}
                </li>
              ))}
            </ul>
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
          {person ? "Enregistrer les modifications" : "Créer le contact"}
        </Button>
        <Cancel href={person ? `/${section}/${person.id}` : `/${section}`} />
      </div>
    </form>
  );
}
