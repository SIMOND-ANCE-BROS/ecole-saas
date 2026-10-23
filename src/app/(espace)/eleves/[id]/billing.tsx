"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { StudentRecord, StudentRelative } from "@/db/students";
import { type Choice, PersonChoice, toInput } from "../../_people/person-choice";
import { invoice, billNewPerson } from "../actions";

type Props = {
  studentId: string;
  firstName: string;
  minor: boolean;
  billedTo: StudentRecord["billedTo"];
  /** Relatives who can be invoiced (guardians and relatives « vers » the student). */
  relatives: StudentRelative[];
  siblings: StudentRecord["siblings"];
};

/** « Facturé à »: a single payer, changed in one gesture. */
export function Billing({
  studentId: studentId,
  firstName: firstName,
  minor: minor,
  billedTo,
  relatives: relatives,
  siblings: siblings,
}: Props) {
  const [open, setOpen] = useState(false);
  const [autre, setOther] = useState<Choice | null>(null);
  const [seeOther, setSeeOther] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();

  const choose = (action: () => Promise<{ message: string | null }>) =>
    startTransition(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) {
        setOpen(false);
        setSeeOther(false);
        setOther(null);
      }
    });

  const current =
    billedTo.type === "personne" ? billedTo.name : billedTo.type === "eleve" ? `${firstName} (paie ses cours)` : null;

  return (
    <section aria-labelledby="facture-a" className="panneau flex flex-col gap-2 p-4 text-sm">
      <h2 id="facture-a" className="text-sm font-semibold">
        Facturé à
      </h2>
      {current ? (
        <p className="text-base font-medium">
          {billedTo.type === "personne" ? (
            <Link href={`/personnes/${billedTo.id}`} className="lien">
              {current}
            </Link>
          ) : (
            current
          )}
        </p>
      ) : (
        <p role="alert" className="text-alerte-texte">
          Personne : {firstName} est mineur, indiquez à qui facturer.
        </p>
      )}
      {siblings.length > 0 && (
        <p className="text-doux">
          Même payeur que{" "}
          {siblings.map((f, i) => (
            <span key={f.id}>
              {i > 0 && ", "}
              <Link href={`/eleves/${f.id}`} className="lien">
                {f.firstName}
              </Link>
            </span>
          ))}{" "}
          : réduction fratrie.
        </p>
      )}

      {!open ? (
        <button type="button" className="bouton-secondaire self-start" onClick={() => setOpen(true)}>
          {current ? "Changer" : "Choisir"}
        </button>
      ) : (
        <fieldset className="flex flex-col gap-1.5 border-t border-bordure pt-2">
          <legend className="sr-only">Facturer à</legend>
          {!minor && (
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="facturer"
                checked={billedTo.type === "eleve"}
                disabled={inProgress}
                onChange={() => choose(() => invoice(studentId, { type: "eleve" }))}
              />
              {firstName}
            </label>
          )}
          {relatives.map((p) => (
            <label key={p.id} className="flex items-center gap-2">
              <input
                type="radio"
                name="facturer"
                checked={billedTo.type === "personne" && billedTo.id === p.id}
                disabled={inProgress}
                onChange={() => choose(() => invoice(studentId, { type: "personne", id: p.id }))}
              />
              {p.name}
              <span className="text-xs text-doux">
                {p.relation === "responsable" ? "responsable" : p.relation === "partner" ? "conjoint" : "proche"}
              </span>
            </label>
          ))}
          <label className="flex items-center gap-2">
            <input type="radio" name="facturer" checked={seeOther} onChange={() => setSeeOther(true)} />
            Un autre payeur : CSE, entreprise, proche…
          </label>
          {seeOther && (
            <div className="flex flex-col gap-2 pl-6">
              <PersonChoice
                id="autre-payeur"
                label="Quel payeur ?"
                value={autre}
                onChange={setOther}
                exclude={[studentId]}
                organization
              />
              <button
                type="button"
                className="bouton-principal self-start"
                disabled={inProgress || !autre}
                onClick={() => autre && choose(() => billNewPerson(studentId, toInput(autre)))}
              >
                Facturer à ce payeur
              </button>
            </div>
          )}
          <button type="button" className="lien self-start text-xs" onClick={() => setOpen(false)}>
            Fermer
          </button>
        </fieldset>
      )}
      {message && (
        <p role="alert" className="text-erreur">
          {message}
        </p>
      )}
    </section>
  );
}
