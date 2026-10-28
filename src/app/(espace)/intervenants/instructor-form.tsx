"use client";

import { Alert, Button, Checkbox, Fieldset, Group, Select, TextInput, type TextInputProps } from "@mantine/core";
import { useActionState, useEffect, useRef, useState } from "react";
import { type Instructor, PAY_MODES, VAT_REGIMES, STATUSES, PAY_UNITS } from "@/db/instructors";
import { saveInstructor, type FormState } from "./actions";
import { INSTRUCTOR, type InstructorField } from "./fields";
import { Cancel } from "@/app/(espace)/_panel/panel";
import { BusinessSearch } from "@/app/(espace)/_ui/business-search";
import type { Business } from "@/connectors/business-registry/registry";

type Mode = keyof typeof PAY_UNITS;

/** Amount in cents → euro input (« 40 », « 40,50 »), without floating-point numbers. */
const inEuros = (c: number) => `${Math.trunc(c / 100)}${c % 100 ? `,${String(c % 100).padStart(2, "0")}` : ""}`;

function toValues(i: Instructor | null): Record<InstructorField, string> {
  return {
    firstName: i?.firstName ?? "",
    name: i?.name ?? "",
    email: i?.email ?? "",
    status: i?.status ?? "sole_trader",
    siren: i?.siren ?? "",
    vatRegime: i?.vatRegime ?? "franchise_293b",
    payMode: i?.payMode ?? "hourly",
    tariff: i ? inEuros(i.rateCents) : "",
    isOwner: i?.isOwner ? "on" : "",
    active: !i || i.active ? "on" : "",
  };
}

export function InstructorForm({ instructor: instructor }: { instructor: Instructor | null }) {
  const action = saveInstructor.bind(null, instructor?.id ?? null);
  const [state, send, inProgress] = useActionState<FormState, FormData>(action, {
    attempt: 0,
    errors: {},
    values: null,
  });
  // Remounted after each rejection to restore the input returned by the server.
  return (
    <Champs
      key={state.attempt}
      state={state}
      send={send}
      inProgress={inProgress}
      back={instructor ? `/intervenants/${instructor.id}` : "/intervenants"}
      edition={instructor !== null}
      initial={toValues(instructor)}
    />
  );
}

type PropsChamps = {
  state: FormState;
  send: (f: FormData) => void;
  inProgress: boolean;
  edition: boolean;
  back: string;
  initial: Record<InstructorField, string>;
};

function Champs({ state: state, send: send, inProgress: inProgress, edition, initial, back: back }: PropsChamps) {
  const v = state.values ?? initial;
  const [status, setStatus] = useState(v.status);
  const [mode, setMode] = useState(v.payMode as Mode);
  const [siren, setSiren] = useState(v.siren);
  // Company picked in the registry: shown under the SIREN to check it is the right one.
  const [found, setFound] = useState<Business | null>(null);
  const e = state.errors;
  const form = useRef<HTMLFormElement>(null);
  // Empty rate: said before sending, like a missing required field.
  const [tariffMissing, setTariffMissing] = useState(false);

  // After a rejection, focus goes to the first field in error.
  useEffect(() => {
    if (state.attempt > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state.attempt]);

  const field = (name: InstructorField, label: string, props: TextInputProps = {}) => (
    <TextInput id={name} name={INSTRUCTOR.name(name)} label={label} defaultValue={v[name]} error={e[name]} {...props} />
  );
  // Capitalised in the menu only (« à l’heure » stays lower case inside sentences).
  const options = (labels: Record<string, string>) =>
    Object.entries(labels).map(([value, label]) => ({ value, label: label.charAt(0).toUpperCase() + label.slice(1) }));

  return (
    <form
      ref={form}
      action={send}
      className="flex w-full min-w-0 flex-col gap-5"
      noValidate
      onSubmit={(ev) => {
        const tariff = ev.currentTarget.elements.namedItem(INSTRUCTOR.name("tariff"));
        if (tariff instanceof HTMLInputElement && tariff.value.trim() === "") {
          ev.preventDefault();
          setTariffMissing(true);
          tariff.focus();
        }
      }}
    >
      {e.form && (
        <Alert color="red" role="alert">
          {e.form}
        </Alert>
      )}

      <Fieldset legend="Identité" className="grid gap-3 sm:grid-cols-2">
        {field("firstName", "Prénom", {
          autoComplete: "off",
          autoFocus: !edition && state.attempt === 0,
          required: true,
        })}
        {field("name", "Nom", { autoComplete: "off", required: true })}
        <div className="sm:col-span-2">
          {field("email", "E-mail (facultatif, pour l’agenda et les relevés)", { type: "email", autoComplete: "off" })}
        </div>
      </Fieldset>

      <Fieldset legend="Statut et TVA" className="grid items-start gap-3 sm:grid-cols-2">
        <Select
          id="status"
          label="Statut"
          name={INSTRUCTOR.name("status")}
          allowDeselect={false}
          data={options(STATUSES)}
          defaultValue={v.status}
          onChange={(x) => x && setStatus(x)}
        />
        <Select
          id="vatRegime"
          label="TVA"
          name={INSTRUCTOR.name("vatRegime")}
          allowDeselect={false}
          data={options(VAT_REGIMES)}
          defaultValue={v.vatRegime}
        />
        {status !== "employee" ? (
          <>
            <div className="sm:col-span-2">
              <BusinessSearch
                description="Nom de l’entreprise ou de l’intervenant, SIREN ou SIRET : choisir une entreprise remplit le SIREN."
                onPick={(b) => {
                  setSiren(b.siren);
                  setFound(b);
                }}
              />
            </div>
            {field("siren", "SIREN (facultatif)", {
              inputMode: "numeric",
              autoComplete: "off",
              placeholder: "9 chiffres",
              value: siren,
              defaultValue: undefined,
              onChange: (ev) => {
                setSiren(ev.currentTarget.value);
                setFound(null);
              },
              description: found
                ? [found.legalName, found.legalForm, found.city].filter(Boolean).join(" — ") +
                  (found.ceased ? " — entreprise fermée" : "")
                : undefined,
              inputWrapperOrder: ["label", "input", "description", "error"],
            })}
          </>
        ) : (
          <input type="hidden" name={INSTRUCTOR.name("siren")} value="" />
        )}
        <Checkbox
          className="self-end pb-2"
          name={INSTRUCTOR.name("isOwner")}
          defaultChecked={v.isOwner === "on"}
          label="Dirigeant de l’école"
        />
      </Fieldset>

      <Fieldset legend="Rémunération" className="grid gap-3 sm:grid-cols-2">
        <Select
          id="payMode"
          label="Mode de rémunération"
          name={INSTRUCTOR.name("payMode")}
          allowDeselect={false}
          data={options(PAY_MODES)}
          defaultValue={v.payMode}
          onChange={(x) => x && setMode(x as Mode)}
        />
        {/* Unit in the label: read with the field (Mantine replaces any aria-describedby given to the input). */}
        {field("tariff", `Tarif (€ / ${PAY_UNITS[mode]})`, {
          inputMode: "decimal",
          autoComplete: "off",
          required: true,
          error: tariffMissing ? "Tarif obligatoire" : e.tariff,
          onChange: () => setTariffMissing(false),
          styles: { input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } },
        })}
      </Fieldset>

      {edition && (
        <Checkbox
          name={INSTRUCTOR.name("active")}
          defaultChecked={v.active === "on"}
          label="Actif"
          description="Décocher quand l’intervenant quitte l’école : son historique est conservé."
        />
      )}

      <Group gap="xs" className="border-t border-bordure pt-4">
        <Button type="submit" loading={inProgress}>
          {edition ? "Enregistrer les modifications" : "Ajouter l’intervenant"}
        </Button>
        <Cancel href={back} />
      </Group>
    </form>
  );
}
