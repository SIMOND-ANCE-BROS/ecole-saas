"use client";

import { useEffect, useState } from "react";
import type { ResultatPersonne } from "@/db/personnes";
import { nomAffiche } from "@/domaine/personnes/nom";
import { requeteDifferee } from "@/lib/requete-differee";
import { chercherPersonnes } from "./actions";

/** Personne choisie dans la base, ou à créer avec l'essentiel. */
export type Choix =
  | { id: string; nom: string }
  | {
      nouveau: {
        type: "particulier" | "professionnel";
        prenom: string;
        nom: string;
        raisonSociale: string;
        siren: string;
        telephone: string;
        email: string;
      };
    };

export const nouvellePersonne = (type: "particulier" | "professionnel"): Choix => ({
  nouveau: { type, prenom: "", nom: "", raisonSociale: "", siren: "", telephone: "", email: "" },
});

/** Pour l'envoi au serveur : forme attendue par saisiePersonneValide. */
export function versSaisie(c: Choix) {
  if ("id" in c) return { id: c.id };
  const n = c.nouveau;
  return {
    nouveau: {
      type: n.type,
      nom: n.nom,
      prenom: n.prenom,
      raisonSociale: n.raisonSociale,
      siren: n.siren,
      email: n.email,
      telephone: n.telephone,
      adresse: "",
      dateNaissance: "",
      notes: "",
    },
  };
}

type Props = {
  /** Identifiant de base des champs (plusieurs choix sur une même page). */
  id: string;
  libelle: string;
  valeur: Choix | null;
  onChange: (c: Choix | null) => void;
  /** Personnes à ne pas proposer (l'élève lui-même). */
  exclure?: string[];
  /** Organisme (CSE, entreprise) plutôt que particulier pour une nouvelle personne. */
  organisme?: boolean;
  erreurs?: Partial<Record<string, string>>;
};

/**
 * Rechercher une personne déjà connue (nom, téléphone…) ou en créer une avec
 * l'essentiel, sans quitter le formulaire.
 */
export function ChoixPersonne({ id, libelle, valeur, onChange, exclure = [], organisme = false, erreurs = {} }: Props) {
  const [saisie, setSaisie] = useState("");
  const [resultats, setResultats] = useState<ResultatPersonne[] | null>(null);
  const [erreur, setErreur] = useState(false);
  const active = saisie.trim().length >= 2 && !valeur;
  // Clé stable : un tableau recréé à chaque rendu relancerait la recherche sans fin.
  const exclus = exclure.join(",");

  useEffect(() => {
    if (!active) return;
    return requeteDifferee(
      () => chercherPersonnes(saisie),
      (r) => {
        setResultats(r.filter((p) => !exclus.split(",").includes(p.id)));
        setErreur(false);
      },
      () => setErreur(true),
    );
  }, [saisie, active, exclus]);

  if (valeur && "id" in valeur) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{valeur.nom}</span>
        <button type="button" className="lien text-sm" onClick={() => onChange(null)}>
          Changer
        </button>
      </div>
    );
  }

  if (valeur && "nouveau" in valeur) {
    const n = valeur.nouveau;
    const maj = (champ: keyof typeof n) => (e: { target: { value: string } }) =>
      onChange({ nouveau: { ...n, [champ]: e.target.value } });
    const champ = (cle: keyof typeof n, texte: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-${cle}`} className="text-sm">
          {texte}
        </label>
        <input
          id={`${id}-${cle}`}
          className="champ"
          autoComplete="off"
          value={n[cle]}
          onChange={maj(cle)}
          aria-invalid={erreurs[cle] ? true : undefined}
          {...props}
        />
        {erreurs[cle] && <p className="text-xs text-erreur">{erreurs[cle]}</p>}
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
              {champ("raisonSociale", "Raison sociale", { autoFocus: true })}
              {champ("siren", "SIREN", { inputMode: "numeric", placeholder: "9 chiffres" })}
            </>
          ) : (
            <>
              {champ("prenom", "Prénom", { autoFocus: true })}
              {champ("nom", "Nom")}
            </>
          )}
          {champ("telephone", "Téléphone", { type: "tel", inputMode: "tel" })}
          {champ("email", "E-mail", { type: "email" })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-cherche`} className="text-sm">
        {libelle}
      </label>
      <input
        id={`${id}-cherche`}
        type="search"
        className="champ"
        autoComplete="off"
        placeholder="Nom, prénom, téléphone…"
        value={saisie}
        onChange={(e) => {
          setSaisie(e.target.value);
          setResultats(null);
        }}
      />
      <div role="status" className="text-xs text-doux">
        {active &&
          (erreur
            ? "Recherche indisponible, réessayez."
            : resultats === null
              ? "Recherche…"
              : resultats.length === 0
                ? "Personne de connu à ce nom."
                : "")}
      </div>
      {active && resultats && resultats.length > 0 && (
        <ul className="panneau max-h-56 divide-y divide-bordure overflow-y-auto text-sm">
          {resultats.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full flex-wrap gap-x-3 px-3 py-2 text-left hover:bg-accent-doux/40"
                onClick={() => {
                  onChange({ id: p.id, nom: nomAffiche(p) });
                  setSaisie("");
                }}
              >
                <span className="font-medium">{nomAffiche(p)}</span>
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
        onClick={() => onChange(nouvellePersonne(organisme ? "professionnel" : "particulier"))}
      >
        {organisme ? "Nouvel organisme (CSE, entreprise…)" : "Nouvelle personne"}
      </button>
    </div>
  );
}
