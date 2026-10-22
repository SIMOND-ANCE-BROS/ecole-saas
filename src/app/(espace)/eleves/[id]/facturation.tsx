"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { FicheEleve, ProcheEleve } from "@/db/eleves";
import { type Choix, ChoixPersonne, versSaisie } from "../../_personnes/choix-personne";
import { facturer, facturerNouvelle } from "../actions";

type Props = {
  eleveId: string;
  prenom: string;
  mineur: boolean;
  factureA: FicheEleve["factureA"];
  /** Proches qui peuvent être facturés (responsables et proches « vers » l'élève). */
  proches: ProcheEleve[];
  fratrie: FicheEleve["fratrie"];
};

/** « Facturé à » : un seul payeur, changé en un geste. */
export function Facturation({ eleveId, prenom, mineur, factureA, proches, fratrie }: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [autre, setAutre] = useState<Choix | null>(null);
  const [voirAutre, setVoirAutre] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  const choisir = (action: () => Promise<{ message: string | null }>) =>
    demarrer(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) {
        setOuvert(false);
        setVoirAutre(false);
        setAutre(null);
      }
    });

  const actuel =
    factureA.type === "personne" ? factureA.nom : factureA.type === "eleve" ? `${prenom} (paie ses cours)` : null;

  return (
    <section aria-labelledby="facture-a" className="panneau flex flex-col gap-2 p-4 text-sm">
      <h2 id="facture-a" className="text-sm font-semibold">
        Facturé à
      </h2>
      {actuel ? (
        <p className="text-base font-medium">
          {factureA.type === "personne" ? (
            <Link href={`/personnes/${factureA.id}`} className="lien">
              {actuel}
            </Link>
          ) : (
            actuel
          )}
        </p>
      ) : (
        <p role="alert" className="text-alerte-texte">
          Personne : {prenom} est mineur, indiquez à qui facturer.
        </p>
      )}
      {fratrie.length > 0 && (
        <p className="text-doux">
          Même payeur que{" "}
          {fratrie.map((f, i) => (
            <span key={f.id}>
              {i > 0 && ", "}
              <Link href={`/eleves/${f.id}`} className="lien">
                {f.prenom}
              </Link>
            </span>
          ))}{" "}
          : réduction fratrie.
        </p>
      )}

      {!ouvert ? (
        <button type="button" className="bouton-secondaire self-start" onClick={() => setOuvert(true)}>
          {actuel ? "Changer" : "Choisir"}
        </button>
      ) : (
        <fieldset className="flex flex-col gap-1.5 border-t border-bordure pt-2">
          <legend className="sr-only">Facturer à</legend>
          {!mineur && (
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="facturer"
                checked={factureA.type === "eleve"}
                disabled={enCours}
                onChange={() => choisir(() => facturer(eleveId, { type: "eleve" }))}
              />
              {prenom}
            </label>
          )}
          {proches.map((p) => (
            <label key={p.id} className="flex items-center gap-2">
              <input
                type="radio"
                name="facturer"
                checked={factureA.type === "personne" && factureA.id === p.id}
                disabled={enCours}
                onChange={() => choisir(() => facturer(eleveId, { type: "personne", id: p.id }))}
              />
              {p.nom}
              <span className="text-xs text-doux">
                {p.relation === "responsable" ? "responsable" : p.relation === "conjoint" ? "conjoint" : "proche"}
              </span>
            </label>
          ))}
          <label className="flex items-center gap-2">
            <input type="radio" name="facturer" checked={voirAutre} onChange={() => setVoirAutre(true)} />
            Un autre payeur : CSE, entreprise, proche…
          </label>
          {voirAutre && (
            <div className="flex flex-col gap-2 pl-6">
              <ChoixPersonne
                id="autre-payeur"
                libelle="Quel payeur ?"
                valeur={autre}
                onChange={setAutre}
                exclure={[eleveId]}
                organisme
              />
              <button
                type="button"
                className="bouton-principal self-start"
                disabled={enCours || !autre}
                onClick={() => autre && choisir(() => facturerNouvelle(eleveId, versSaisie(autre)))}
              >
                Facturer à ce payeur
              </button>
            </div>
          )}
          <button type="button" className="lien self-start text-xs" onClick={() => setOuvert(false)}>
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
