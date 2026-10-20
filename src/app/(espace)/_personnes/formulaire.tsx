"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { FichePersonne } from "@/db/personnes";
import { creerContact, modifierIdentite, type Refus } from "./actions";
import { Annuler } from "@/app/(espace)/_panneau/panneau";

type Props = {
  /** Personne modifiée ; null pour la création d'un contact (un élève se crée avec le formulaire guidé). */
  personne: Omit<FichePersonne, "liens" | "cours" | "documents"> | null;
  /** Fiche d'où l'on vient : élève (naissance et notes) ou contact. */
  pour: "eleves" | "contacts";
  nomPropose?: string;
};

/** Identité et coordonnées d'un élève ou d'un contact. */
export function FormulairePersonne({ personne, pour, nomPropose }: Props) {
  const [v, setV] = useState({
    type: personne?.type ?? "particulier",
    nom: personne?.type === "professionnel" ? (personne.nom === personne.raisonSociale ? "" : personne.nom) : (personne?.nom ?? nomPropose ?? ""),
    prenom: personne?.prenom ?? "",
    raisonSociale: personne?.raisonSociale ?? "",
    siren: personne?.siren ?? "",
    dateNaissance: personne?.dateNaissance ?? "",
    telephone: personne?.telephone ?? "",
    email: personne?.email ?? "",
    adresse: personne?.adresse ?? "",
    notes: personne?.notes ?? "",
  });
  const [refus, setRefus] = useState<Refus | null>(null);
  const [envoi, demarrer] = useTransition();
  const formulaire = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (refus) formulaire.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [refus]);
  const pro = v.type === "professionnel";
  const maj = (champ: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [champ]: e.target.value });

  const saisie = {
    ...v,
    raisonSociale: pro ? v.raisonSociale : "",
    siren: pro ? v.siren : "",
    dateNaissance: pro ? "" : v.dateNaissance,
  };
  const eleve = pour === "eleves";
  const envoyer = (confirme: boolean) =>
    demarrer(async () => setRefus(personne ? await modifierIdentite(personne.id, saisie, pour) : await creerContact(saisie, confirme)));

  const champ = (nom: keyof typeof v, libelle: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={nom} className="text-sm font-medium">
        {libelle}
      </label>
      <input
        id={nom}
        className="champ"
        autoComplete="off"
        value={v[nom]}
        onChange={maj(nom)}
        aria-invalid={refus?.erreurs[nom] ? true : undefined}
        aria-describedby={refus?.erreurs[nom] ? `${nom}-erreur` : undefined}
        {...props}
      />
      {refus?.erreurs[nom] && (
        <p id={`${nom}-erreur`} className="text-xs text-erreur">
          {refus.erreurs[nom]}
        </p>
      )}
    </div>
  );

  return (
    <form
      ref={formulaire}
      className="flex w-full min-w-0 flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        envoyer(false);
      }}
    >
      {!eleve && <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <legend className="px-1 text-sm font-semibold">Contact</legend>
        {(
          [
            ["particulier", "Particulier"],
            ["professionnel", "Professionnel (entreprise, CSE, association)"],
          ] as const
        ).map(([valeur, libelle]) => (
          <label key={valeur} className="flex items-center gap-2">
            <input type="radio" name="type" checked={v.type === valeur} onChange={() => setV({ ...v, type: valeur })} />
            {libelle}
          </label>
        ))}
      </fieldset>}

      <fieldset className="panneau p-4">
        <legend className="px-1 text-sm font-semibold">Identité</legend>
      {pro ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {champ("raisonSociale", "Raison sociale", { autoFocus: !personne })}
          {champ("siren", "SIREN", { inputMode: "numeric", placeholder: "9 chiffres" })}
          <div className="sm:col-span-2">{champ("nom", "Contact (facultatif)")}</div>
        </div>
      ) : (
        <div className={`grid gap-3 ${eleve ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {champ("prenom", "Prénom", { autoFocus: !personne })}
          {champ("nom", "Nom")}
          {eleve && champ("dateNaissance", "Date de naissance", { type: "date" })}
        </div>
      )}

      </fieldset>
      <fieldset className="panneau grid gap-3 p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Coordonnées (facultatives)</legend>
        {champ("telephone", "Téléphone", { type: "tel", inputMode: "tel" })}
        {champ("email", "E-mail", { type: "email" })}
        <div className="sm:col-span-2">{champ("adresse", "Adresse (pour les factures et attestations)")}</div>
      </fieldset>

      {eleve && (
        <div className="flex flex-col gap-1">
          <label htmlFor="notes" className="text-sm font-medium">
            Notes (santé, allergies, consignes)
          </label>
          <textarea id="notes" rows={2} className="champ" value={v.notes} onChange={maj("notes")} />
          <p className="text-xs text-doux">Visibles par l’accueil et la direction. N’y notez que ce qui est utile en cours.</p>
        </div>
      )}

      {refus?.doublons ? (
        <div tabIndex={-1} role="alert" className="flex flex-col gap-2 rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">
          <p className="font-medium">{refus.message} Vérifiez avant de créer un doublon :</p>
          <ul className="flex flex-col gap-0.5">
            {refus.doublons.map((d) => (
              <li key={d.id}>
                <Link href={`/personnes/${d.id}`} className="lien" target="_blank">
                  {d.nom}
                </Link>
                {d.telephone && <span className="tabular-nums">, {d.telephone}</span>}
              </li>
            ))}
          </ul>
          <button type="button" className="bouton-secondaire self-start" disabled={envoi} onClick={() => envoyer(true)}>
            Créer quand même
          </button>
        </div>
      ) : (
        refus && (
          <p tabIndex={-1} role="alert" className="text-sm text-erreur">
            {refus.message}
          </p>
        )
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-bordure pt-4">
        <button type="submit" className="bouton-principal" disabled={envoi}>
          {envoi ? "Enregistrement…" : personne ? "Enregistrer les modifications" : "Créer le contact"}
        </button>
        <Annuler href={personne ? `/${pour}/${personne.id}` : `/${pour}`} />
      </div>
    </form>
  );
}
