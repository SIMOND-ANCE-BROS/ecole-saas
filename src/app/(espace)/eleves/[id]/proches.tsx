"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ProcheEleve } from "@/db/eleves";
import { type Choix, ChoixPersonne, versSaisie } from "../../_personnes/choix-personne";
import { Telephone } from "../../_personnes/sections";
import { ajouterUnResponsable, prevenir, retirerProche } from "../actions";

type Props = { eleveId: string; prenom: string; responsables: ProcheEleve[]; autres: ProcheEleve[] };

function nature(p: ProcheEleve, prenom: string): string {
  if (p.sens === "de") return p.relation === "responsable" ? `${prenom} en est responsable` : p.relation === "conjoint" ? "Conjoint" : "Proche";
  return p.relation === "responsable" ? "Responsable légal" : p.relation === "conjoint" ? "Conjoint" : "Proche";
}

/** Responsables et proches de l'élève : à prévenir, retirer, ajouter un responsable. */
export function Proches({ eleveId, prenom, responsables, autres }: Props) {
  const [ajout, setAjout] = useState(false);
  const [choix, setChoix] = useState<Choix | null>(null);
  const [aPrevenir, setAPrevenir] = useState(true);
  const [aRetirer, setARetirer] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  const agir = (action: () => Promise<{ message: string | null }>, apres?: () => void) =>
    demarrer(async () => {
      const r = await action();
      setMessage(r.message);
      if (!r.message) apres?.();
    });

  const ligne = (p: ProcheEleve) => (
    <li key={p.lienId} className="flex flex-col gap-1 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <Link href={`/personnes/${p.id}`} className="lien font-medium">
          {p.nom}
        </Link>
        <span className="text-xs text-doux">{nature(p, prenom)}</span>
        {p.paie && p.sens === "vers" && <span className="rounded bg-accent-doux px-1.5 text-xs">payeur</span>}
        {p.telephone && (
          <span className="ml-auto">
            <Telephone numero={p.telephone} />
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {p.sens === "vers" && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={p.aPrevenir} disabled={enCours} onChange={(e) => agir(() => prevenir(eleveId, p.lienId, e.target.checked))} />À prévenir en cas
            d’urgence
          </label>
        )}
        {aRetirer === p.lienId ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-erreur px-2 py-0.5 text-xs text-erreur hover:bg-erreur/10"
              disabled={enCours}
              onClick={() => agir(() => retirerProche(eleveId, p.lienId), () => setARetirer(null))}
            >
              Retirer {p.nom} de la fiche
            </button>
            <button type="button" className="lien text-xs" onClick={() => setARetirer(null)}>
              Annuler
            </button>
          </span>
        ) : (
          <button type="button" className="lien ml-auto text-xs text-doux" onClick={() => setARetirer(p.lienId)}>
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
          {!ajout && (
            <button type="button" className="lien text-sm" onClick={() => setAjout(true)}>
              Ajouter un responsable
            </button>
          )}
        </div>
        {responsables.length === 0 && !ajout && <p className="text-sm text-doux">Aucun responsable indiqué.</p>}
        {responsables.length > 0 && <ul className="panneau divide-y divide-bordure">{responsables.map(ligne)}</ul>}
        {ajout && (
          <div className="panneau flex flex-col gap-3 p-3 text-sm">
            <ChoixPersonne id="nouveau-responsable" libelle={`Responsable légal de ${prenom} (parent, tuteur)`} valeur={choix} onChange={setChoix} exclure={[eleveId]} />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={aPrevenir} onChange={(e) => setAPrevenir(e.target.checked)} />À prévenir en cas d’urgence
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="bouton-principal"
                disabled={enCours || !choix}
                onClick={() =>
                  choix &&
                  agir(
                    () => ajouterUnResponsable(eleveId, versSaisie(choix), aPrevenir),
                    () => {
                      setAjout(false);
                      setChoix(null);
                    },
                  )
                }
              >
                Ajouter
              </button>
              <button type="button" className="bouton-secondaire" onClick={() => setAjout(false)}>
                Annuler
              </button>
            </div>
          </div>
        )}
      </section>

      {autres.length > 0 && (
        <section aria-labelledby="proches" className="flex flex-col gap-2">
          <h2 id="proches" className="text-base font-semibold">
            Autres proches
          </h2>
          <ul className="panneau divide-y divide-bordure">{autres.map(ligne)}</ul>
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
