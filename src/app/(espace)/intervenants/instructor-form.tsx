"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { type Instructor, PAY_MODES, VAT_REGIMES, STATUSES, PAY_UNITS } from "@/db/instructors";
import { saveInstructor, type FormState } from "./actions";
import { Cancel } from "@/app/(espace)/_panel/panel";

type Mode = keyof typeof PAY_UNITS;

/** Montant en centimes → saisie en euros (« 40 », « 40,50 »), sans nombre à virgule. */
const inEuros = (c: number) => `${Math.trunc(c / 100)}${c % 100 ? `,${String(c % 100).padStart(2, "0")}` : ""}`;

function toValues(i: Instructor | null): Record<string, string> {
  return {
    firstName: i?.firstName ?? "",
    name: i?.name ?? "",
    email: i?.email ?? "",
    status: i?.status ?? "micro_entreprise",
    siren: i?.siren ?? "",
    vatRegime: i?.vatRegime ?? "franchise_293b",
    payMode: i?.payMode ?? "heure",
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
  // Remonté après chaque refus pour reprendre la saisie renvoyée par le serveur.
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
  initial: Record<string, string>;
};

function Champs({ state: state, send: send, inProgress: inProgress, edition, initial, back: back }: PropsChamps) {
  const v = state.values ?? initial;
  const [status, setStatus] = useState(v.status);
  const [mode, setMode] = useState(v.payMode as Mode);
  const e = state.errors;
  const form = useRef<HTMLFormElement>(null);

  // Après un refus, le curseur va sur le premier champ en erreur.
  useEffect(() => {
    if (state.attempt > 0) form.current?.querySelector<HTMLElement>("[aria-invalid]")?.focus();
  }, [state.attempt]);

  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        className="champ"
        defaultValue={v[name]}
        aria-invalid={e[name] ? true : undefined}
        aria-describedby={e[name] ? `${name}-erreur` : undefined}
        {...props}
      />
      {e[name] && (
        <p id={`${name}-erreur`} className="text-xs text-erreur">
          {e[name]}
        </p>
      )}
    </div>
  );

  return (
    <form ref={form} action={send} className="flex w-full min-w-0 flex-col gap-5" noValidate>
      {e.form && (
        <p role="alert" className="text-sm text-erreur">
          {e.form}
        </p>
      )}

      <fieldset className="panneau p-4 grid gap-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Identité</legend>
        {field("firstName", "Prénom", {
          autoComplete: "off",
          autoFocus: !edition && state.attempt === 0,
          required: true,
        })}
        {field("name", "Nom", { autoComplete: "off", required: true })}
        <div className="sm:col-span-2">
          {field("email", "E-mail (facultatif, pour l’agenda et les relevés)", { type: "email", autoComplete: "off" })}
        </div>
      </fieldset>

      <fieldset className="panneau p-4 grid gap-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Statut</legend>
        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-sm font-medium">
            Statut
          </label>
          <select
            id="status"
            name="status"
            className="champ"
            defaultValue={v.status}
            onChange={(x) => setStatus(x.target.value)}
          >
            {Object.entries(STATUSES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {status !== "salarie" ? (
          field("siren", "SIREN (facultatif)", { inputMode: "numeric", autoComplete: "off", placeholder: "9 chiffres" })
        ) : (
          <input type="hidden" name="siren" value="" />
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="vatRegime" className="text-sm font-medium">
            TVA
          </label>
          <select id="vatRegime" name="vatRegime" className="champ" defaultValue={v.vatRegime}>
            {Object.entries(VAT_REGIMES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
          <input type="checkbox" name="isOwner" defaultChecked={v.isOwner === "on"} />
          Dirigeant de l’école
        </label>
      </fieldset>

      <fieldset className="panneau p-4 grid gap-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Rémunération</legend>
        <div className="flex flex-col gap-1">
          <label htmlFor="payMode" className="text-sm font-medium">
            Mode de rémunération
          </label>
          <select
            id="payMode"
            name="payMode"
            className="champ"
            defaultValue={v.payMode}
            onChange={(x) => setMode(x.target.value as Mode)}
          >
            {Object.entries(PAY_MODES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {field("tariff", `Tarif (€ / ${PAY_UNITS[mode]})`, {
          inputMode: "decimal",
          autoComplete: "off",
          required: true,
        })}
      </fieldset>

      {edition && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={v.active === "on"} className="mt-0.5" />
          <span>
            Actif
            <span className="block text-xs text-doux">
              Décocher quand l’intervenant quitte l’école : son historique est conservé.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-bordure pt-4">
        <button type="submit" className="bouton-principal" disabled={inProgress}>
          {inProgress ? "Enregistrement…" : edition ? "Enregistrer les modifications" : "Ajouter l’intervenant"}
        </button>
        <Cancel href={back} />
      </div>
    </form>
  );
}
