"use client";

import { useEffect, useState } from "react";
import type { PersonResult } from "@/db/personnes";
import { displayedName } from "@/domaine/personnes/nom";
import { deferredQuery } from "@/lib/requete-differee";
import { searchPeopleAction } from "./actions";

/** Personne choisie dans la base, ou à créer avec l'essentiel. */
export type Choice =
  | { id: string; name: string }
  | {
      newPerson: {
        type: "particulier" | "professionnel";
        firstName: string;
        name: string;
        companyName: string;
        siren: string;
        telephone: string;
        email: string;
      };
    };

export const newPerson = (type: "particulier" | "professionnel"): Choice => ({
  newPerson: { type, firstName: "", name: "", companyName: "", siren: "", telephone: "", email: "" },
});

/** Pour l'envoi au serveur : forme attendue par saisiePersonneValide. */
export function toInput(c: Choice) {
  if ("id" in c) return { id: c.id };
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
  /** Identifiant de base des champs (plusieurs choix sur une même page). */
  id: string;
  label: string;
  value: Choice | null;
  onChange: (c: Choice | null) => void;
  /** Personnes à ne pas proposer (l'élève lui-même). */
  exclude?: string[];
  /** Organisme (CSE, entreprise) plutôt que particulier pour une nouvelle personne. */
  organization?: boolean;
  errors?: Partial<Record<string, string>>;
};

/**
 * Rechercher une personne déjà connue (nom, téléphone…) ou en créer une avec
 * l'essentiel, sans quitter le formulaire.
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
  const [saisie, setInput] = useState("");
  const [results, setResults] = useState<PersonResult[] | null>(null);
  const [error, setError] = useState(false);
  const active = saisie.trim().length >= 2 && !value;
  // Clé stable : un tableau recréé à chaque rendu relancerait la recherche sans fin.
  const excluded = exclude.join(",");

  useEffect(() => {
    if (!active) return;
    return deferredQuery(
      () => searchPeopleAction(saisie),
      (r) => {
        setResults(r.filter((p) => !excluded.split(",").includes(p.id)));
        setError(false);
      },
      () => setError(true),
    );
  }, [saisie, active, excluded]);

  if (value && "id" in value) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{value.name}</span>
        <button type="button" className="lien text-sm" onClick={() => onChange(null)}>
          Changer
        </button>
      </div>
    );
  }

  if (value && "newPerson" in value) {
    const n = value.newPerson;
    const updated = (field: keyof typeof n) => (e: { target: { value: string } }) =>
      onChange({ newPerson: { ...n, [field]: e.target.value } });
    const field = (key: keyof typeof n, texte: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-${key}`} className="text-sm">
          {texte}
        </label>
        <input
          id={`${id}-${key}`}
          className="champ"
          autoComplete="off"
          value={n[key]}
          onChange={updated(key)}
          aria-invalid={errors[key] ? true : undefined}
          {...props}
        />
        {errors[key] && <p className="text-xs text-erreur">{errors[key]}</p>}
      </div>
    );
    return (
      <div className="flex flex-col gap-2 rounded-md border border-bordure p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {n.type === "professionnel" ? "Nouvel organisme" : "Nouvelle personne"}
          </span>
          <button type="button" className="lien text-sm" onClick={() => onChange(null)}>
            Chercher plutôt une personne connue
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {n.type === "professionnel" ? (
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
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-cherche`} className="text-sm">
        {label}
      </label>
      <input
        id={`${id}-cherche`}
        type="search"
        className="champ"
        autoComplete="off"
        placeholder="Nom, prénom, téléphone…"
        value={saisie}
        onChange={(e) => {
          setInput(e.target.value);
          setResults(null);
        }}
      />
      <div role="status" className="text-xs text-doux">
        {active &&
          (error
            ? "Recherche indisponible, réessayez."
            : results === null
              ? "Recherche…"
              : results.length === 0
                ? "Personne de connu à ce nom."
                : "")}
      </div>
      {active && results && results.length > 0 && (
        <ul className="panneau max-h-56 divide-y divide-bordure overflow-y-auto text-sm">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full flex-wrap gap-x-3 px-3 py-2 text-left hover:bg-accent-doux/40"
                onClick={() => {
                  onChange({ id: p.id, name: displayedName(p) });
                  setInput("");
                }}
              >
                <span className="font-medium">{displayedName(p)}</span>
                {p.telephone && <span className="tabular-nums text-doux">{p.telephone}</span>}
                {p.liees.length > 0 && <span className="text-doux">liée à {p.liees.join(", ")}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="lien self-start text-sm"
        onClick={() => onChange(newPerson(organization ? "professionnel" : "particulier"))}
      >
        {organization ? "Nouvel organisme (CSE, entreprise…)" : "Nouvelle personne"}
      </button>
    </div>
  );
}
