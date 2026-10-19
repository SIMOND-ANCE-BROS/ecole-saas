"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { Famille } from "@/db/familles";
import { creer, modifier, type Refus } from "./actions";

type Props = {
  /** Famille modifiée ; null pour une création (avec un premier danseur facultatif). */
  famille: Omit<Famille, "danseurs"> | null;
};

export function FormulaireFamille({ famille }: Props) {
  const [v, setV] = useState({
    type: famille?.type ?? "particulier",
    nom: famille?.type === "professionnel" ? (famille.nom === famille.raisonSociale ? "" : famille.nom) : (famille?.nom ?? ""),
    prenom: famille?.prenom ?? "",
    raisonSociale: famille?.raisonSociale ?? "",
    siren: famille?.siren ?? "",
    email: famille?.email ?? "",
    telephone: famille?.telephone ?? "",
    adresse: famille?.adresse ?? "",
    danseurPrenom: "",
    danseurNaissance: "",
  });
  const [refus, setRefus] = useState<Refus | null>(null);
  const [envoi, demarrer] = useTransition();
  const pro = v.type === "professionnel";
  const maj = (champ: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [champ]: e.target.value });

  const saisie = {
    type: v.type,
    nom: v.nom,
    prenom: v.prenom,
    raisonSociale: pro ? v.raisonSociale : "",
    siren: pro ? v.siren : "",
    email: v.email,
    telephone: v.telephone,
    adresse: v.adresse,
  };
  const envoyer = (confirme: boolean) =>
    demarrer(async () =>
      setRefus(
        famille
          ? await modifier(famille.id, saisie)
          : await creer(saisie, { prenom: v.danseurPrenom, dateNaissance: v.danseurNaissance }, confirme),
      ),
    );

  const champ = (nom: keyof typeof v, libelle: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, cle: string = nom) => (
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
        aria-invalid={refus?.erreurs[cle] ? true : undefined}
        aria-describedby={refus?.erreurs[cle] ? `${nom}-erreur` : undefined}
        {...props}
      />
      {refus?.erreurs[cle] && (
        <p id={`${nom}-erreur`} className="text-xs text-erreur">
          {refus.erreurs[cle]}
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
      <fieldset className="flex gap-4 text-sm">
        <legend className="mb-2 text-sm font-semibold">Payeur</legend>
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
          {champ("raisonSociale", "Raison sociale", { autoFocus: !famille })}
          {champ("siren", "SIREN", { inputMode: "numeric", placeholder: "9 chiffres" })}
          <div className="sm:col-span-2">{champ("nom", "Contact (facultatif)")}</div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {champ("nom", "Nom", { autoFocus: !famille })}
          {champ("prenom", "Prénom")}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {champ("telephone", "Téléphone", { type: "tel", inputMode: "tel" })}
        {champ("email", "E-mail", { type: "email" })}
        <div className="sm:col-span-2">{champ("adresse", "Adresse (pour les factures et attestations)")}</div>
      </div>

      {!famille && (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-semibold">Premier danseur (facultatif)</legend>
          <p className="text-xs text-doux sm:col-span-2">Les autres danseurs s’ajoutent ensuite depuis la fiche de la famille.</p>
          {champ("danseurPrenom", "Prénom", {}, "danseur.prenom")}
          {champ("danseurNaissance", "Date de naissance", { type: "date" }, "danseur.dateNaissance")}
        </fieldset>
      )}

      {refus?.doublons ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte">
          <p className="font-medium">{refus.message} Vérifiez avant de créer un doublon :</p>
          <ul className="flex flex-col gap-0.5">
            {refus.doublons.map((d) => (
              <li key={d.id}>
                <Link href={`/familles/${d.id}`} className="lien">
                  {d.raisonSociale ?? [d.nom, d.prenom].filter(Boolean).join(" ")}
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
          {envoi ? "Enregistrement…" : famille ? "Enregistrer les modifications" : "Créer la famille"}
        </button>
        <Link href={famille ? `/familles/${famille.id}` : "/familles"} className="bouton-secondaire">
          Annuler
        </Link>
      </div>
    </form>
  );
}
