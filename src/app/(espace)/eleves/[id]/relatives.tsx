"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { StudentRelative } from "@/db/students";
import { type Choice, PersonChoice, toInput } from "../../_people/person-choice";
import { Telephone } from "../../_people/sections";
import { addGuardianAction, notify, removeRelative } from "../actions";

type Props = { studentId: string; firstName: string; guardians: StudentRelative[]; other: StudentRelative[] };

function nature(p: StudentRelative, firstName: string): string {
  if (p.sens === "de")
    return p.relation === "responsable"
      ? `${firstName} en est responsable`
      : p.relation === "conjoint"
        ? "Conjoint"
        : "Proche";
  return p.relation === "responsable" ? "Responsable légal" : p.relation === "conjoint" ? "Conjoint" : "Proche";
}

/** The student's guardians and relatives: « à prévenir », remove, add a guardian. */
export function Relatives({ studentId: studentId, firstName: firstName, guardians: guardians, other: other }: Props) {
  const [addition, setAddition] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [toNotify, setToNotify] = useState(true);
  const [toRemove, setToRemove] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inProgress, startTransition] = useTransition();

  const act = (action: () => Promise<{ message: string | null }>, after?: () => void) =>
    startTransition(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) after?.();
    });

  const row = (p: StudentRelative) => (
    <li key={p.relationshipId} className="flex flex-col gap-1 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <Link href={`/personnes/${p.id}`} className="lien font-medium">
          {p.name}
        </Link>
        <span className="text-xs text-doux">{nature(p, firstName)}</span>
        {p.paysFor && p.sens === "vers" && <span className="rounded bg-accent-doux px-1.5 text-xs">payeur</span>}
        {p.telephone && (
          <span className="ml-auto">
            <Telephone number={p.telephone} />
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {p.sens === "vers" && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={p.toNotify}
              disabled={inProgress}
              onChange={(e) => act(() => notify(studentId, p.relationshipId, e.target.checked))}
            />
            À prévenir en cas d’urgence
          </label>
        )}
        {toRemove === p.relationshipId ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-erreur px-2 py-0.5 text-xs text-erreur hover:bg-erreur/10"
              disabled={inProgress}
              onClick={() =>
                act(
                  () => removeRelative(studentId, p.relationshipId),
                  () => setToRemove(null),
                )
              }
            >
              Retirer {p.name} de la fiche
            </button>
            <button type="button" className="lien text-xs" onClick={() => setToRemove(null)}>
              Annuler
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="lien ml-auto text-xs text-doux"
            onClick={() => setToRemove(p.relationshipId)}
          >
            Retirer
          </button>
        )}
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="responsables" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="responsables" className="text-base font-semibold">
            Responsables
          </h2>
          {!addition && (
            <button type="button" className="lien text-sm" onClick={() => setAddition(true)}>
              Ajouter un responsable
            </button>
          )}
        </div>
        {guardians.length === 0 && !addition && <p className="text-sm text-doux">Aucun responsable indiqué.</p>}
        {guardians.length > 0 && <ul className="panneau divide-y divide-bordure">{guardians.map(row)}</ul>}
        {addition && (
          <div className="panneau flex flex-col gap-3 p-3 text-sm">
            <PersonChoice
              id="nouveau-responsable"
              label={`Responsable légal de ${firstName} (parent, tuteur)`}
              value={choice}
              onChange={setChoice}
              exclude={[studentId]}
            />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={toNotify} onChange={(e) => setToNotify(e.target.checked)} />À prévenir en
              cas d’urgence
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="bouton-principal"
                disabled={inProgress || !choice}
                onClick={() =>
                  choice &&
                  act(
                    () => addGuardianAction(studentId, toInput(choice), toNotify),
                    () => {
                      setAddition(false);
                      setChoice(null);
                    },
                  )
                }
              >
                Ajouter
              </button>
              <button type="button" className="bouton-secondaire" onClick={() => setAddition(false)}>
                Annuler
              </button>
            </div>
          </div>
        )}
      </section>

      {other.length > 0 && (
        <section aria-labelledby="proches" className="flex flex-col gap-2">
          <h2 id="proches" className="text-base font-semibold">
            Autres proches
          </h2>
          <ul className="panneau divide-y divide-bordure">{other.map(row)}</ul>
        </section>
      )}

      {message && (
        <p role="alert" className="text-sm text-erreur">
          {message}
        </p>
      )}
    </div>
  );
}
