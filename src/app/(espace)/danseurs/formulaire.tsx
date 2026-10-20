"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import type { SaisieDanseur } from "@/db/danseurs";
import { enregistrerDanseur, type EtatFormulaire } from "./actions";

type Props = {
  cible: { payeurId: string } | { id: string };
  danseur: SaisieDanseur | null;
  /** Nom de famille proposé pour un nouveau danseur. */
  nomPropose?: string;
  retour: string;
};

export function FormulaireDanseur({ cible, danseur, nomPropose, retour }: Props) {
  const [etat, envoyer, enCours] = useActionState<EtatFormulaire, FormData>(enregistrerDanseur.bind(null, cible), {
    essai: 0,
    erreurs: {},
    valeurs: null,
  });
  const initial: Record<string, string> = {
    prenom: danseur?.prenom ?? "",
    nom: danseur?.nom ?? nomPropose ?? "",
    dateNaissance: danseur?.dateNaissance ?? "",
    contactUrgence: danseur?.contactUrgence ?? "",
    telephoneUrgence: danseur?.telephoneUrgence ?? "",
    notes: danseur?.notes ?? "",
  };
  return (
    <Champs key={etat.essai} etat={etat} envoyer={envoyer} enCours={enCours} v={etat.valeurs ?? initial} edition={danseur !== null} retour={retour} />
  );
}

type PropsChamps = {
  etat: EtatFormulaire;
  envoyer: (f: FormData) => void;
  enCours: boolean;
  v: Record<string, string>;
  edition: boolean;
  retour: string;
};

function Champs({ etat, envoyer, enCours, v, edition, retour }: PropsChamps) {
  const e = etat.erreurs;
  const formulaire = useRef<HTMLFormElement>(null);
  // Après un refus, le curseur va sur le premier champ en erreur.
  useEffect(() => {
    if (etat.essai > 0) formulaire.current?.querySelector<HTMLElement>("[aria-invalid]")?.focus();
  }, [etat.essai]);

  const champ = (nom: string, libelle: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={nom} className="text-sm font-medium">
        {libelle}
      </label>
      <input
        id={nom}
        name={nom}
        className="champ"
        autoComplete="off"
        defaultValue={v[nom]}
        aria-invalid={e[nom] ? true : undefined}
        aria-describedby={e[nom] ? `${nom}-erreur` : undefined}
        {...props}
      />
      {e[nom] && (
        <p id={`${nom}-erreur`} className="text-xs text-erreur">
          {e[nom]}
        </p>
      )}
    </div>
  );

  return (
    <form ref={formulaire} action={envoyer} className="flex max-w-2xl flex-col gap-5" noValidate>
      {e.formulaire && (
        <p role="alert" className="text-sm text-erreur">
          {e.formulaire}
        </p>
      )}
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">Identité</legend>
        {champ("prenom", "Prénom", { autoFocus: !edition && etat.essai === 0, required: true })}
        {champ("nom", "Nom", { required: true })}
        {champ("dateNaissance", "Date de naissance", { type: "date" })}
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">En cas d’urgence</legend>
        {champ("contactUrgence", "Personne à prévenir", { placeholder: "Nom et lien avec le danseur" })}
        {champ("telephoneUrgence", "Téléphone", { type: "tel", inputMode: "tel" })}
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor="notes" className="text-sm font-medium">
          Notes (santé, allergies, consignes)
        </label>
        <textarea id="notes" name="notes" rows={3} className="champ" defaultValue={v.notes} />
        <p className="text-xs text-doux">Visibles par l’accueil et la direction. N’y notez que ce qui est utile en cours.</p>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="bouton-principal" disabled={enCours}>
          {enCours ? "Enregistrement…" : edition ? "Enregistrer les modifications" : "Ajouter le danseur"}
        </button>
        <Link href={retour} className="bouton-secondaire">
          Annuler
        </Link>
      </div>
    </form>
  );
}
