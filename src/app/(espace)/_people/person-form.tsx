"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { PersonRecord } from "@/db/people";
import { createContact, updateIdentity, type Refusal } from "./actions";
import { Cancel } from "@/app/(espace)/_panel/panel";

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
    type: person?.type ?? "particulier",
    name:
      person?.type === "professionnel"
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
  const pro = v.type === "professionnel";
  const updated = (field: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [field]: e.target.value });

  const saisie = {
    ...v,
    companyName: pro ? v.companyName : "",
    siren: pro ? v.siren : "",
    birthDate: pro ? "" : v.birthDate,
  };
  const student = section === "eleves";
  const send = (confirmed: boolean) =>
    startTransition(async () =>
      setRefusal(person ? await updateIdentity(person.id, saisie, section) : await createContact(saisie, confirmed)),
    );

  const field = (name: keyof typeof v, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        className="champ"
        autoComplete="off"
        value={v[name]}
        onChange={updated(name)}
        aria-invalid={refusal?.errors[name] ? true : undefined}
        aria-describedby={refusal?.errors[name] ? `${name}-erreur` : undefined}
        {...props}
      />
      {refusal?.errors[name] && (
        <p id={`${name}-erreur`} className="text-xs text-erreur">
          {refusal.errors[name]}
        </p>
      )}
    </div>
  );

  return (
    <form
      ref={form}
      className="flex w-full min-w-0 flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        send(false);
      }}
    >
      {!student && (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <legend className="px-1 text-sm font-semibold">Contact</legend>
          {(
            [
              ["particulier", "Particulier"],
              ["professionnel", "Professionnel (entreprise, CSE, association)"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="type" checked={v.type === value} onChange={() => setV({ ...v, type: value })} />
              {label}
            </label>
          ))}
        </fieldset>
      )}

      <fieldset className="panneau p-4">
        <legend className="px-1 text-sm font-semibold">Identité</legend>
        {pro ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {field("companyName", "Raison sociale", { autoFocus: !person })}
            {field("siren", "SIREN", { inputMode: "numeric", placeholder: "9 chiffres" })}
            <div className="sm:col-span-2">{field("name", "Contact (facultatif)")}</div>
          </div>
        ) : (
          <div className={`grid gap-3 ${student ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            {field("firstName", "Prénom", { autoFocus: !person })}
            {field("name", "Nom")}
            {student && field("birthDate", "Date de naissance", { type: "date" })}
          </div>
        )}
      </fieldset>
      <fieldset className="panneau grid gap-3 p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Coordonnées (facultatives)</legend>
        {field("telephone", "Téléphone", { type: "tel", inputMode: "tel" })}
        {field("email", "E-mail", { type: "email" })}
        <div className="sm:col-span-2">{field("address", "Adresse (pour les factures et attestations)")}</div>
      </fieldset>

      {student && (
        <div className="flex flex-col gap-1">
          <label htmlFor="notes" className="text-sm font-medium">
            Notes (santé, allergies, consignes)
          </label>
          <textarea id="notes" rows={2} className="champ" value={v.notes} onChange={updated("notes")} />
          <p className="text-xs text-doux">
            Visibles par l’accueil et la direction. N’y notez que ce qui est utile en cours.
          </p>
        </div>
      )}

      {refusal?.duplicates ? (
        <div
          tabIndex={-1}
          role="alert"
          className="flex flex-col gap-2 rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte"
        >
          <p className="font-medium">{refusal.message} Vérifiez avant de créer un doublon :</p>
          <ul className="flex flex-col gap-0.5">
            {refusal.duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/personnes/${d.id}`} className="lien" target="_blank">
                  {d.name}
                </Link>
                {d.telephone && <span className="tabular-nums">, {d.telephone}</span>}
              </li>
            ))}
          </ul>
          <button type="button" className="bouton-secondaire self-start" disabled={sending} onClick={() => send(true)}>
            Créer quand même
          </button>
        </div>
      ) : (
        refusal && (
          <p tabIndex={-1} role="alert" className="text-sm text-erreur">
            {refusal.message}
          </p>
        )
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-bordure pt-4">
        <button type="submit" className="bouton-principal" disabled={sending}>
          {sending ? "Enregistrement…" : person ? "Enregistrer les modifications" : "Créer le contact"}
        </button>
        <Cancel href={person ? `/${section}/${person.id}` : `/${section}`} />
      </div>
    </form>
  );
}
