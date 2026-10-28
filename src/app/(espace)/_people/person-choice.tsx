"use client";

import { Anchor, Paper, Text, TextInput, type TextInputProps, UnstyledButton } from "@mantine/core";
import { useEffect, useState } from "react";
import type { PersonInput, PersonResult } from "@/db/people";
import type { FieldErrors } from "@/lib/form-errors";
import { displayedName } from "@/domain/people/name";
import { deferredQuery } from "@/lib/deferred-query";
import { searchPeopleAction } from "./actions";
import { has } from "@/lib/has";

/** Person picked from the database, or to be created with the essentials. */
export type Choice =
  | { id: string; name: string }
  | {
      newPerson: {
        type: "individual" | "organisation";
        firstName: string;
        name: string;
        companyName: string;
        siren: string;
        telephone: string;
        email: string;
      };
    };

export const newPerson = (type: "individual" | "organisation"): Choice => ({
  newPerson: { type, firstName: "", name: "", companyName: "", siren: "", telephone: "", email: "" },
});

/** For sending to the server: shape expected by validPersonInput. */
export function toInput(c: Choice) {
  if (has(c, "id")) return { id: c.id };
  const n = c.newPerson;
  return {
    newPerson: {
      type: n.type,
      name: n.name,
      firstName: n.firstName,
      companyName: n.companyName,
      siren: n.siren,
      email: n.email,
      telephone: n.telephone,
      address: "",
      birthDate: "",
      notes: "",
    },
  };
}

type Props = {
  /** Base id of the fields (several choices on the same page). */
  id: string;
  label: string;
  value: Choice | null;
  onChange: (c: Choice | null) => void;
  /** People not to offer (the student themself). */
  exclude?: string[];
  /** Organisation (CSE, company) rather than individual for a new person. */
  organization?: boolean;
  errors?: FieldErrors<PersonInput>;
};

/**
 * Search for an already known person (name, phone…) or create one with the
 * essentials, without leaving the form.
 */
export function PersonChoice({
  id,
  label: label,
  value: value,
  onChange,
  exclude: exclude = [],
  organization: organization = false,
  errors: errors = {},
}: Props) {
  const [entry, setInput] = useState("");
  const [results, setResults] = useState<PersonResult[] | null>(null);
  const [error, setError] = useState(false);
  const active = entry.trim().length >= 2 && !value;
  // Stable key: an array recreated on every render would restart the search endlessly.
  const excluded = exclude.join(",");

  useEffect(() => {
    if (!active) return;
    return deferredQuery(
      () => searchPeopleAction(entry),
      (r) => {
        setResults(r.filter((p) => !excluded.split(",").includes(p.id)));
        setError(false);
      },
      () => setError(true),
    );
  }, [entry, active, excluded]);

  if (value && has(value, "id")) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{value.name}</span>
        <Anchor component="button" type="button" size="sm" onClick={() => onChange(null)}>
          Changer
        </Anchor>
      </div>
    );
  }

  if (value && has(value, "newPerson")) {
    const n = value.newPerson;
    const updated = (field: keyof typeof n) => (e: { currentTarget: { value: string } }) =>
      onChange({ newPerson: { ...n, [field]: e.currentTarget.value } });
    const field = (
      key: keyof typeof n,
      text: string,
      props: Pick<TextInputProps, "autoFocus" | "inputMode" | "placeholder" | "type"> = {},
    ) => (
      <TextInput
        id={`${id}-${key}`}
        label={text}
        autoComplete="off"
        value={n[key]}
        onChange={updated(key)}
        error={errors[key]}
        {...props}
      />
    );
    return (
      <Paper withBorder p="sm" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text size="sm" fw={500}>
            {n.type === "organisation" ? "Nouvel organisme" : "Nouvelle personne"}
          </Text>
          <Anchor component="button" type="button" size="sm" onClick={() => onChange(null)}>
            Chercher plutôt une personne connue
          </Anchor>
        </div>
        <div className="grid items-start gap-2 sm:grid-cols-2">
          {n.type === "organisation" ? (
            <>
              {field("companyName", "Raison sociale", { autoFocus: true })}
              {field("siren", "SIREN", { inputMode: "numeric", placeholder: "9 chiffres" })}
            </>
          ) : (
            <>
              {field("firstName", "Prénom", { autoFocus: true })}
              {field("name", "Nom")}
            </>
          )}
          {field("telephone", "Téléphone", { type: "tel", inputMode: "tel" })}
          {field("email", "E-mail", { type: "email" })}
        </div>
      </Paper>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <TextInput
        id={`${id}-cherche`}
        label={label}
        type="search"
        autoComplete="off"
        placeholder="Nom, prénom, téléphone…"
        value={entry}
        onChange={(e) => {
          setInput(e.currentTarget.value);
          setResults(null);
        }}
      />
      <Text role="status" size="xs" c="dimmed">
        {active &&
          (error
            ? "Recherche indisponible, réessayez."
            : results === null
              ? "Recherche…"
              : results.length === 0
                ? "Personne de connu à ce nom."
                : "")}
      </Text>
      {active && results && results.length > 0 && (
        <Paper withBorder component="ul" className="max-h-56 divide-y divide-bordure overflow-y-auto text-sm">
          {results.map((p) => (
            <li key={p.id}>
              <UnstyledButton
                className="flex w-full flex-wrap gap-x-3 px-3 py-2 text-left text-sm hover:bg-accent-doux/40 focus-visible:bg-accent-doux/40"
                onClick={() => {
                  onChange({ id: p.id, name: displayedName(p) });
                  setInput("");
                }}
              >
                <span className="font-medium">{displayedName(p)}</span>
                {p.telephone && (
                  <Text span size="sm" c="dimmed" className="tabular-nums">
                    {p.telephone}
                  </Text>
                )}
                {p.liees.length > 0 && (
                  <Text span size="sm" c="dimmed">
                    liée à {p.liees.join(", ")}
                  </Text>
                )}
              </UnstyledButton>
            </li>
          ))}
        </Paper>
      )}
      <Anchor
        component="button"
        type="button"
        size="sm"
        className="self-start"
        onClick={() => onChange(newPerson(organization ? "organisation" : "individual"))}
      >
        {organization ? "Nouvel organisme (CSE, entreprise…)" : "Nouvelle personne"}
      </Anchor>
    </div>
  );
}
