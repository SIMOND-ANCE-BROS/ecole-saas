"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { FichePersonne } from "@/db/personnes";
import { creer, modifier, type Refus } from "./actions";
import { RELATIONS, type Relation } from "./relations";

type Props = {
  /** Personne modifiée ; null pour une création. */
  personne: Omit<FichePersonne, "liens" | "cours" | "documents"> | null;
  /** Création depuis une fiche : la nouvelle personne y sera liée. */
  lienAvec?: { ficheId: string; ficheNom: string; relation: Relation };
  /** Nom de famille proposé (enfant ajouté depuis la fiche d'un parent). */
  nomPropose?: string;
};

export function FormulairePersonne({ personne, lienAvec, nomPropose }: Props) {
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
  const [relation, setRelation] = useState<Relation>(lienAvec?.relation ?? "representant");
  const [paiePour, setPaiePour] = useState(lienAvec ? RELATIONS[lienAvec.relation].type === "representant_legal" : false);
  const [contactUrgence, setContactUrgence] = useState(lienAvec ? RELATIONS[lienAvec.relation].type === "representant_legal" : false);
  const [refus, setRefus] = useState<Refus | null>(null);
  const [envoi, demarrer] = useTransition();
  const pro = v.type === "professionnel";
  const maj = (champ: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [champ]: e.target.value });

  const saisie = {
    ...v,
    raisonSociale: pro ? v.raisonSociale : "",
    siren: pro ? v.siren : "",
    dateNaissance: pro ? "" : v.dateNaissance,
  };
  const nouvelle = pro ? v.raisonSociale || "La nouvelle personne" : [v.prenom, v.nom].filter(Boolean).join(" ") || "La nouvelle personne";
  const [de, vers] = lienAvec && RELATIONS[relation].de === "fiche" ? [lienAvec.ficheNom, nouvelle] : [nouvelle, lienAvec?.ficheNom];
  const envoyer = (confirme: boolean) =>
    demarrer(async () =>
      setRefus(
        personne
          ? await modifier(personne.id, saisie)
          : await creer(saisie, confirme, lienAvec ? { ficheId: lienAvec.ficheId, relation, paiePour, contactUrgence } : null),
      ),
    );

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
      className="flex max-w-2xl flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        envoyer(false);
      }}
    >
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <legend className="mb-2 text-sm font-semibold">Personne</legend>
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
      </fieldset>

      {pro ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {champ("raisonSociale", "Raison sociale", { autoFocus: !personne })}
          {champ("siren", "SIREN", { inputMode: "numeric", placeholder: "9 chiffres" })}
          <div className="sm:col-span-2">{champ("nom", "Contact (facultatif)")}</div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {champ("prenom", "Prénom", { autoFocus: !personne })}
          {champ("nom", "Nom")}
          {champ("dateNaissance", "Date de naissance", { type: "date" })}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {champ("telephone", "Téléphone", { type: "tel", inputMode: "tel" })}
        {champ("email", "E-mail", { type: "email" })}
        <div className="sm:col-span-2">{champ("adresse", "Adresse (pour les factures et attestations)")}</div>
      </div>

      {!pro && (
        <div className="flex flex-col gap-1">
          <label htmlFor="notes" className="text-sm font-medium">
            Notes (santé, allergies, consignes)
          </label>
          <textarea id="notes" rows={2} className="champ" value={v.notes} onChange={maj("notes")} />
          <p className="text-xs text-doux">Visibles par l’accueil et la direction. N’y notez que ce qui est utile en cours.</p>
        </div>
      )}

      {lienAvec && (
        <fieldset className="panneau flex flex-col gap-2 p-3 text-sm">
          <legend className="px-1 text-sm font-semibold">Lien avec {lienAvec.ficheNom}</legend>
          <label htmlFor="relation">Pour {lienAvec.ficheNom}, c’est :</label>
          <select id="relation" className="champ" value={relation} onChange={(e) => {
              // Un représentant légal paie et est prévenu en cas d'urgence, sauf avis contraire.
              const r = e.target.value as Relation;
              setRelation(r);
              setPaiePour(RELATIONS[r].type === "representant_legal");
              setContactUrgence(RELATIONS[r].type === "representant_legal");
            }}>
            {Object.entries(RELATIONS).map(([k, r]) => (
              <option key={k} value={k}>
                {r.libelle}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={paiePour} onChange={(e) => setPaiePour(e.target.checked)} />
            {de} paie les cours de {vers}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={contactUrgence} onChange={(e) => setContactUrgence(e.target.checked)} />
            {de} est à prévenir en cas d’urgence pour {vers}
          </label>
        </fieldset>
      )}

      {refus?.doublons ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">
          <p className="font-medium">{refus.message} Vérifiez avant de créer un doublon :</p>
          <ul className="flex flex-col gap-0.5">
            {refus.doublons.map((d) => (
              <li key={d.id}>
                <Link href={`/personnes/${d.id}`} className="lien">
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
          <p role="alert" className="text-sm text-erreur">
            {refus.message}
          </p>
        )
      )}

      <div className="flex gap-2">
        <button type="submit" className="bouton-principal" disabled={envoi}>
          {envoi ? "Enregistrement…" : personne ? "Enregistrer les modifications" : "Créer la personne"}
        </button>
        <Link href={personne ? `/personnes/${personne.id}` : lienAvec ? `/personnes/${lienAvec.ficheId}` : "/personnes"} className="bouton-secondaire">
          Annuler
        </Link>
      </div>
    </form>
  );
}
