"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ageAu } from "@/domaine/personnes/age";
import { type Choix, ChoixPersonne, versSaisie } from "../../_personnes/choix-personne";
import { creerEleveGuide, type RefusEleve } from "../actions";
import { Annuler } from "@/app/(espace)/_panneau/panneau";

type Facturation = "eleve" | "responsable" | "autre";

/**
 * Nouvel élève en une seule saisie : identité ; s'il est mineur, son
 * responsable (connu ou nouveau) et s'il faut le prévenir ; puis à qui facturer.
 */
export function GuideNouvelEleve({
  aujourdhui,
  responsableInitial,
}: {
  aujourdhui: string;
  responsableInitial?: { id: string; nom: string };
}) {
  const [e, setE] = useState({ prenom: "", nom: "", dateNaissance: "", telephone: "", email: "", notes: "" });
  const [avecResponsable, setAvecResponsable] = useState<boolean | null>(responsableInitial ? true : null);
  const [responsable, setResponsable] = useState<Choix | null>(responsableInitial ?? null);
  const [aPrevenir, setAPrevenir] = useState(true);
  const [facturation, setFacturation] = useState<Facturation | null>(null);
  const [payeur, setPayeur] = useState<Choix | null>(null);
  const [refus, setRefus] = useState<RefusEleve | null>(null);
  const [envoi, demarrer] = useTransition();
  const formulaire = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (refus) formulaire.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [refus]);

  const age = /^\d{4}-\d{2}-\d{2}$/.test(e.dateNaissance) ? ageAu(e.dateNaissance, aujourdhui) : null;
  const mineur = age !== null && age < 18;
  // Par défaut : un mineur a un responsable qui paie ; un adulte paie lui-même. L'accueil peut changer.
  const responsableAffiche = avecResponsable ?? mineur;
  const factureChoisie: Facturation = facturation ?? (responsableAffiche ? "responsable" : "eleve");
  const prenom = e.prenom.trim() || "l’élève";
  const nomResponsable = responsable
    ? "id" in responsable
      ? responsable.nom
      : [responsable.nouveau.prenom, responsable.nouveau.nom].filter(Boolean).join(" ") || "le responsable"
    : "le responsable";

  const maj = (champ: keyof typeof e) => (x: { target: { value: string } }) => setE({ ...e, [champ]: x.target.value });
  const erreur = (cle: string) => refus?.erreurs[cle];
  const sous = (prefixe: string) =>
    Object.fromEntries(
      Object.entries(refus?.erreurs ?? {}).flatMap(([k, v]) =>
        k.startsWith(prefixe) ? [[k.slice(prefixe.length), v]] : [],
      ),
    );

  const envoyer = (confirme: boolean) =>
    demarrer(async () =>
      setRefus(
        await creerEleveGuide(
          {
            eleve: { type: "particulier", raisonSociale: "", siren: "", adresse: "", ...e },
            responsable: responsableAffiche && responsable ? versSaisie(responsable) : null,
            aPrevenir,
            facturation:
              factureChoisie === "autre"
                ? { type: "autre", payeur: payeur ? versSaisie(payeur) : null }
                : { type: factureChoisie },
          },
          confirme,
        ),
      ),
    );

  const champ = (cle: keyof typeof e, libelle: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={cle} className="text-sm font-medium">
        {libelle}
      </label>
      <input
        id={cle}
        className="champ"
        autoComplete="off"
        value={e[cle]}
        onChange={maj(cle)}
        aria-invalid={erreur(`eleve.${cle}`) ? true : undefined}
        {...props}
      />
      {erreur(`eleve.${cle}`) && <p className="text-xs text-erreur">{erreur(`eleve.${cle}`)}</p>}
    </div>
  );

  return (
    <form
      ref={formulaire}
      className="flex w-full min-w-0 flex-col gap-5"
      noValidate
      onSubmit={(x) => {
        x.preventDefault();
        envoyer(false);
      }}
    >
      <fieldset className="panneau grid gap-3 p-4 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">1. L’élève</legend>
        {champ("prenom", "Prénom", { autoFocus: true })}
        {champ("nom", "Nom")}
        {champ("dateNaissance", "Date de naissance", { type: "date", max: aujourdhui })}
        {champ("telephone", "Téléphone (facultatif)", { type: "tel", inputMode: "tel" })}
        {champ("email", "E-mail (facultatif)", { type: "email" })}
        <p className="self-end pb-2 text-sm text-doux" aria-live="polite">
          {age !== null && (mineur ? `${age} ans : mineur, un responsable est demandé.` : `${age} ans.`)}
        </p>
        <div className="flex flex-col gap-1 sm:col-span-3">
          <label htmlFor="notes" className="text-sm font-medium">
            Santé, allergies, consignes (facultatif)
          </label>
          <textarea id="notes" rows={2} className="champ" value={e.notes} onChange={maj("notes")} />
        </div>
      </fieldset>

      <fieldset className="panneau flex flex-col gap-3 p-4">
        <legend className="px-1 text-sm font-semibold">2. Son responsable</legend>
        {responsableAffiche ? (
          <>
            <ChoixPersonne
              id="responsable"
              libelle={`Qui est le responsable légal de ${prenom} (parent, tuteur) ?`}
              valeur={responsable}
              onChange={(c) => {
                // Nouvelle personne : même nom de famille proposé.
                setResponsable(
                  c && "nouveau" in c && !c.nouveau.nom && !c.nouveau.prenom
                    ? { nouveau: { ...c.nouveau, nom: e.nom } }
                    : c,
                );
              }}
              erreurs={sous("responsable.nouveau.")}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={aPrevenir} onChange={(x) => setAPrevenir(x.target.checked)} />À prévenir
              en cas d’urgence
            </label>
            {!mineur && (
              <button type="button" className="lien self-start text-sm" onClick={() => setAvecResponsable(false)}>
                Pas de responsable
              </button>
            )}
          </>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-sm text-doux">
            Pas de responsable pour un élève majeur.
            <button type="button" className="lien" onClick={() => setAvecResponsable(true)}>
              En ajouter un quand même
            </button>
          </p>
        )}
      </fieldset>

      <fieldset className="panneau flex flex-col gap-2 p-4 text-sm">
        <legend className="px-1 text-sm font-semibold">3. À qui facturer ?</legend>
        {(
          [
            ["eleve", `À ${prenom}`, !mineur],
            ["responsable", `Au responsable${responsable ? ` (${nomResponsable})` : ""}`, responsableAffiche],
            ["autre", "À un autre payeur : CSE, entreprise, proche…", true],
          ] as const
        )
          .filter(([, , visible]) => visible)
          .map(([valeur, libelle]) => (
            <label key={valeur} className="flex items-center gap-2">
              <input
                type="radio"
                name="facturation"
                checked={factureChoisie === valeur}
                onChange={() => setFacturation(valeur)}
              />
              {libelle}
            </label>
          ))}
        {factureChoisie === "autre" && (
          <ChoixPersonne
            id="payeur"
            libelle="Quel payeur ?"
            valeur={payeur}
            onChange={setPayeur}
            organisme
            erreurs={sous("facturation.payeur.nouveau.")}
          />
        )}
        {erreur("facturation") && <p className="text-xs text-erreur">{erreur("facturation")}</p>}
        <p className="text-xs text-doux">
          Les frères et sœurs facturés à la même personne bénéficient de la réduction fratrie.
        </p>
      </fieldset>

      {refus?.doublons ? (
        <div
          tabIndex={-1}
          role="alert"
          className="flex flex-col gap-2 rounded-md bg-alerte-fond px-3 py-2 text-sm text-alerte-texte"
        >
          <p className="font-medium">{refus.message} Vérifiez avant de créer un doublon :</p>
          <ul className="flex flex-col gap-0.5">
            {refus.doublons.map((d) => (
              <li key={`${d.role}-${d.id}`}>
                {d.role} :{" "}
                <Link href={`/personnes/${d.id}`} className="lien" target="_blank">
                  {d.nom}
                </Link>
                {d.telephone && <span className="tabular-nums">, {d.telephone}</span>}
              </li>
            ))}
          </ul>
          <p>Pour réutiliser une personne existante, cherchez-la dans le champ correspondant.</p>
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
          {envoi ? "Enregistrement…" : "Créer l’élève"}
        </button>
        <Annuler href="/eleves" />
      </div>
    </form>
  );
}
