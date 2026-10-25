"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ageAt } from "@/domain/people/age";
import { type Choice, PersonChoice, toInput } from "../../_people/person-choice";
import { createStudentFromGuide, type StudentRefusal } from "../actions";
import { Cancel } from "@/app/(espace)/_panel/panel";
import type { StudentInput } from "@/db/students";

/** Checked against the server schema: a value renamed on one side fails to compile. */
type Billing = StudentInput["billing"]["type"];

/**
 * New student in a single entry: identity; if a minor, their guardian
 * (known or new) and whether to notify them; then whom to invoice.
 */
export function NewStudentGuide({
  today: today,
  initialGuardian: initialGuardian,
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
  useEffect(() => {
    if (refusal) form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [refusal]);

  const age = /^\d{4}-\d{2}-\d{2}$/.test(e.birthDate) ? ageAt(e.birthDate, today) : null;
  const minor = age !== null && age < 18;
  // By default: a minor has a guardian who pays; an adult pays for themself. The front desk can change it.
  const displayedGuardian = withGuardian ?? minor;
  const chosenBilling: Billing = billing ?? (displayedGuardian ? "guardian" : "self");
  const firstName = e.firstName.trim() || "l’élève";
  const guardianName = guardian
    ? "id" in guardian
      ? guardian.name
      : [guardian.newPerson.firstName, guardian.newPerson.name].filter(Boolean).join(" ") || "le responsable"
    : "le responsable";

  const updated = (field: keyof typeof e) => (x: { target: { value: string } }) =>
    setE({ ...e, [field]: x.target.value });
  const error = (key: string) => refusal?.errors[key];
  const sous = (prefix: string) =>
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
            toNotify: toNotify,
            billing:
              chosenBilling === "other"
                ? { type: "other", payer: payer ? toInput(payer) : null }
                : { type: chosenBilling },
          },
          confirmed,
        ),
      ),
    );

  const field = (key: keyof typeof e, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={key} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={key}
        className="champ"
        autoComplete="off"
        value={e[key]}
        onChange={updated(key)}
        aria-invalid={error(`student.${key}`) ? true : undefined}
        {...props}
      />
      {error(`student.${key}`) && <p className="text-xs text-erreur">{error(`student.${key}`)}</p>}
    </div>
  );

  return (
    <form
      ref={form}
      className="flex w-full min-w-0 flex-col gap-5"
      noValidate
      onSubmit={(x) => {
        x.preventDefault();
        send(false);
      }}
    >
      <fieldset className="panneau grid gap-3 p-4 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">1. L’élève</legend>
        {field("firstName", "Prénom", { autoFocus: true })}
        {field("name", "Nom")}
        {field("birthDate", "Date de naissance", { type: "date", max: today })}
        {field("telephone", "Téléphone (facultatif)", { type: "tel", inputMode: "tel" })}
        {field("email", "E-mail (facultatif)", { type: "email" })}
        <p className="self-end pb-2 text-sm text-doux" aria-live="polite">
          {age !== null && (minor ? `${age} ans : mineur, un responsable est demandé.` : `${age} ans.`)}
        </p>
        <div className="flex flex-col gap-1 sm:col-span-3">
          <label htmlFor="notes" className="text-sm font-medium">
            Santé, allergies, consignes (facultatif)
          </label>
          <textarea id="notes" rows={2} className="champ" value={e.notes} onChange={updated("notes")} />
        </div>
      </fieldset>

      <fieldset className="panneau flex flex-col gap-3 p-4">
        <legend className="px-1 text-sm font-semibold">2. Son responsable</legend>
        {displayedGuardian ? (
          <>
            <PersonChoice
              id="responsable"
              label={`Qui est le responsable légal de ${firstName} (parent, tuteur) ?`}
              value={guardian}
              onChange={(c) => {
                // New person: same family name suggested.
                setGuardian(
                  c && "newPerson" in c && !c.newPerson.name && !c.newPerson.firstName
                    ? { newPerson: { ...c.newPerson, name: e.name } }
                    : c,
                );
              }}
              errors={sous("guardian.newPerson.")}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={toNotify} onChange={(x) => setToNotify(x.target.checked)} />À prévenir en
              cas d’urgence
            </label>
            {!minor && (
              <button type="button" className="lien self-start text-sm" onClick={() => setWithGuardian(false)}>
                Pas de responsable
              </button>
            )}
          </>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-sm text-doux">
            Pas de responsable pour un élève majeur.
            <button type="button" className="lien" onClick={() => setWithGuardian(true)}>
              En ajouter un quand même
            </button>
          </p>
        )}
      </fieldset>

      <fieldset className="panneau flex flex-col gap-2 p-4 text-sm">
        <legend className="px-1 text-sm font-semibold">3. À qui facturer ?</legend>
        {(
          [
            ["self", `À ${firstName}`, !minor],
            ["guardian", `Au responsable${guardian ? ` (${guardianName})` : ""}`, displayedGuardian],
            ["other", "À un autre payeur : CSE, entreprise, proche…", true],
          ] as const
        )
          .filter(([, , visible]) => visible)
          .map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="facturation"
                checked={chosenBilling === value}
                onChange={() => setBilling(value)}
              />
              {label}
            </label>
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
        {error("billing") && <p className="text-xs text-erreur">{error("billing")}</p>}
        <p className="text-xs text-doux">
          Les frères et sœurs facturés à la même personne bénéficient de la réduction fratrie.
        </p>
      </fieldset>

      {refusal?.duplicates ? (
        <div
          tabIndex={-1}
          role="alert"
          className="flex flex-col gap-2 rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte"
        >
          <p className="font-medium">{refusal.message} Vérifiez avant de créer un doublon :</p>
          <ul className="flex flex-col gap-0.5">
            {refusal.duplicates.map((d) => (
              <li key={`${d.role}-${d.id}`}>
                {d.role} :{" "}
                <Link href={`/personnes/${d.id}`} className="lien" target="_blank">
                  {d.name}
                </Link>
                {d.telephone && <span className="tabular-nums">, {d.telephone}</span>}
              </li>
            ))}
          </ul>
          <p>Pour réutiliser une personne existante, cherchez-la dans le champ correspondant.</p>
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
          {sending ? "Enregistrement…" : "Créer l’élève"}
        </button>
        <Cancel href="/eleves" />
      </div>
    </form>
  );
}
