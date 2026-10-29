"use client";

import { Anchor, Badge, Paper, Text, TextInput, type TextInputProps, UnstyledButton } from "@mantine/core";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { PersonInput, PersonResult } from "@/db/people";
import type { FieldErrors } from "@/lib/form-errors";
import { displayedName } from "@/domain/people/name";
import { isMinor, todayInParis } from "@/domain/people/age";
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
  /**
   * Guardian search: only individuals are offered, an organisation cannot be
   * a legal guardian (#216). Known minors are offered last, tagged « mineur ».
   * Not hidden: a minor parent can hold parental authority.
   */
  guardian?: boolean;
  errors?: FieldErrors<PersonInput>;
};

const minor = (p: PersonResult) => isMinor(p.birthDate, todayInParis());

/**
 * Search for an already known person (name, phone…) or create one with the
 * essentials, without leaving the form. Keyboard: ↓ / ↑ walk the results,
 * Enter picks the focused one (or the only one, from the search field) and
 * never submits the surrounding form.
 */
export function PersonChoice({
  id,
  label: label,
  value: value,
  onChange,
  exclude: exclude = [],
  organization: organization = false,
  guardian = false,
  errors: errors = {},
}: Props) {
  const [entry, setInput] = useState("");
  const [results, setResults] = useState<PersonResult[] | null>(null);
  const [error, setError] = useState(false);
  const active = entry.trim().length >= 2 && !value;
  // Stable key: an array recreated on every render would restart the search endlessly.
  const excluded = exclude.join(",");
  const search = useRef<HTMLInputElement>(null);
  const change = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // Where focus goes once the new value is drawn: the control that replaced the one clicked.
  const focusNext = useRef<"change" | "search" | null>(null);

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "change") change.current?.focus();
    if (target === "search") search.current?.focus();
  }, [value]);

  useEffect(() => {
    if (!active) return;
    return deferredQuery(
      () => searchPeopleAction(entry, guardian),
      (r) => {
        const offered = r.filter((p) => !excluded.split(",").includes(p.id));
        // Stable sort: the order of the search stays within adults and within minors.
        setResults(guardian ? [...offered].sort((a, b) => Number(minor(a)) - Number(minor(b))) : offered);
        setError(false);
      },
      () => setError(true),
    );
  }, [entry, active, excluded, guardian]);

  const pick = (p: PersonResult) => {
    focusNext.current = "change";
    onChange({ id: p.id, name: displayedName(p) });
    setInput("");
  };
  const searchAgain = () => {
    focusNext.current = "search";
    onChange(null);
  };
  const firstResult = () => list.current?.querySelector<HTMLButtonElement>("button[data-result]");
  const walk = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-result]")];
    const position = all.findIndex((b) => b === document.activeElement);
    // Up from the first result goes back to the search field.
    if (e.key === "ArrowUp" && position <= 0) search.current?.focus();
    else all[e.key === "ArrowDown" ? Math.min(position + 1, all.length - 1) : position - 1]?.focus();
  };

  if (value && has(value, "id")) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{value.name}</span>
        <Anchor ref={change} id={`${id}-change`} component="button" type="button" size="sm" onClick={searchAgain}>
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
          <Anchor component="button" type="button" size="sm" onClick={searchAgain}>
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
        ref={search}
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
        onKeyDown={(e) => {
          const shown = active && results ? results : [];
          if (e.key === "ArrowDown" && shown.length > 0) {
            e.preventDefault();
            firstResult()?.focus();
          }
          if (e.key === "Enter") {
            // Enter searches, it never submits the form around.
            e.preventDefault();
            if (shown.length === 1) pick(shown[0]);
            else if (shown.length > 1) firstResult()?.focus();
          }
        }}
      />
      <Text role="status" size="xs" c="dimmed">
        {active &&
          (error
            ? "Recherche indisponible, réessayez."
            : results === null
              ? "Recherche…"
              : results.length === 0
                ? "Aucune personne connue à ce nom."
                : "")}
      </Text>
      {active && results && results.length > 0 && (
        <Paper
          ref={list}
          withBorder
          component="ul"
          aria-label="Personnes trouvées"
          className="max-h-56 divide-y divide-bordure overflow-y-auto text-sm"
          onKeyDown={walk}
        >
          {results.map((p) => (
            <li key={p.id}>
              {/* Outline drawn inside the row: the scrolling list would clip one drawn outside. */}
              <UnstyledButton
                data-result
                className="flex w-full flex-wrap gap-x-3 px-3 py-2 text-left text-sm outline-none hover:bg-(--mantine-primary-color-light) focus-visible:bg-(--mantine-primary-color-light) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--mantine-primary-color-filled)"
                onClick={() => pick(p)}
              >
                <span className="font-medium">{displayedName(p)}</span>
                {guardian && minor(p) && (
                  <Badge color="gray" variant="light" radius="sm" tt="none" fw={400}>
                    mineur
                  </Badge>
                )}
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
