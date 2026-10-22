"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { type Intervenant, MODES_REMUNERATION, REGIMES_TVA, STATUTS, UNITES_REMUNERATION } from "@/db/intervenants";
import { enregistrerIntervenant, type EtatFormulaire } from "./actions";
import { Annuler } from "@/app/(espace)/_panneau/panneau";

type Mode = keyof typeof UNITES_REMUNERATION;

/** Montant en centimes → saisie en euros (« 40 », « 40,50 »), sans nombre à virgule. */
const enEuros = (c: number) => `${Math.trunc(c / 100)}${c % 100 ? `,${String(c % 100).padStart(2, "0")}` : ""}`;

function versValeurs(i: Intervenant | null): Record<string, string> {
  return {
    prenom: i?.prenom ?? "",
    nom: i?.nom ?? "",
    email: i?.email ?? "",
    statut: i?.statut ?? "micro_entreprise",
    siren: i?.siren ?? "",
    regimeTva: i?.regimeTva ?? "franchise_293b",
    modeRemuneration: i?.modeRemuneration ?? "heure",
    tarif: i ? enEuros(i.tarifCentimes) : "",
    estDirigeant: i?.estDirigeant ? "on" : "",
    actif: !i || i.actif ? "on" : "",
  };
}

export function FormulaireIntervenant({ intervenant }: { intervenant: Intervenant | null }) {
  const action = enregistrerIntervenant.bind(null, intervenant?.id ?? null);
  const [etat, envoyer, enCours] = useActionState<EtatFormulaire, FormData>(action, {
    essai: 0,
    erreurs: {},
    valeurs: null,
  });
  // Remonté après chaque refus pour reprendre la saisie renvoyée par le serveur.
  return (
    <Champs
      key={etat.essai}
      etat={etat}
      envoyer={envoyer}
      enCours={enCours}
      retour={intervenant ? `/intervenants/${intervenant.id}` : "/intervenants"}
      edition={intervenant !== null}
      initial={versValeurs(intervenant)}
    />
  );
}

type PropsChamps = {
  etat: EtatFormulaire;
  envoyer: (f: FormData) => void;
  enCours: boolean;
  edition: boolean;
  retour: string;
  initial: Record<string, string>;
};

function Champs({ etat, envoyer, enCours, edition, initial, retour }: PropsChamps) {
  const v = etat.valeurs ?? initial;
  const [statut, setStatut] = useState(v.statut);
  const [mode, setMode] = useState(v.modeRemuneration as Mode);
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
    <form ref={formulaire} action={envoyer} className="flex w-full min-w-0 flex-col gap-5" noValidate>
      {e.formulaire && (
        <p role="alert" className="text-sm text-erreur">
          {e.formulaire}
        </p>
      )}

      <fieldset className="panneau p-4 grid gap-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Identité</legend>
        {champ("prenom", "Prénom", { autoComplete: "off", autoFocus: !edition && etat.essai === 0, required: true })}
        {champ("nom", "Nom", { autoComplete: "off", required: true })}
        <div className="sm:col-span-2">
          {champ("email", "E-mail (facultatif, pour l’agenda et les relevés)", { type: "email", autoComplete: "off" })}
        </div>
      </fieldset>

      <fieldset className="panneau p-4 grid gap-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Statut</legend>
        <div className="flex flex-col gap-1">
          <label htmlFor="statut" className="text-sm font-medium">
            Statut
          </label>
          <select
            id="statut"
            name="statut"
            className="champ"
            defaultValue={v.statut}
            onChange={(x) => setStatut(x.target.value)}
          >
            {Object.entries(STATUTS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {statut !== "salarie" ? (
          champ("siren", "SIREN (facultatif)", { inputMode: "numeric", autoComplete: "off", placeholder: "9 chiffres" })
        ) : (
          <input type="hidden" name="siren" value="" />
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="regimeTva" className="text-sm font-medium">
            TVA
          </label>
          <select id="regimeTva" name="regimeTva" className="champ" defaultValue={v.regimeTva}>
            {Object.entries(REGIMES_TVA).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
          <input type="checkbox" name="estDirigeant" defaultChecked={v.estDirigeant === "on"} />
          Dirigeant de l’école
        </label>
      </fieldset>

      <fieldset className="panneau p-4 grid gap-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Rémunération</legend>
        <div className="flex flex-col gap-1">
          <label htmlFor="modeRemuneration" className="text-sm font-medium">
            Mode de rémunération
          </label>
          <select
            id="modeRemuneration"
            name="modeRemuneration"
            className="champ"
            defaultValue={v.modeRemuneration}
            onChange={(x) => setMode(x.target.value as Mode)}
          >
            {Object.entries(MODES_REMUNERATION).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {champ("tarif", `Tarif (€ / ${UNITES_REMUNERATION[mode]})`, {
          inputMode: "decimal",
          autoComplete: "off",
          required: true,
        })}
      </fieldset>

      {edition && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="actif" defaultChecked={v.actif === "on"} className="mt-0.5" />
          <span>
            Actif
            <span className="block text-xs text-doux">
              Décocher quand l’intervenant quitte l’école : son historique est conservé.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-bordure pt-4">
        <button type="submit" className="bouton-principal" disabled={enCours}>
          {enCours ? "Enregistrement…" : edition ? "Enregistrer les modifications" : "Ajouter l’intervenant"}
        </button>
        <Annuler href={retour} />
      </div>
    </form>
  );
}
