"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { LienFiche } from "@/db/personnes";
import { changerDrapeaux, retirerLien } from "../actions";
import { natureDuLien } from "../relations";

/** Liens d'une fiche : « paie » et « urgence » se cochent sur place, un lien se retire après confirmation. */
export function LiensPersonne({ liens, prenom }: { liens: LienFiche[]; prenom: string }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [aRetirer, setARetirer] = useState<string | null>(null);

  const agir = (action: () => Promise<{ message: string | null }>) =>
    demarrer(async () => {
      const { message } = await action();
      setErreur(message);
      setARetirer(null);
      router.refresh();
    });

  // Les drapeaux vont de `personne` vers `lie_a` : leur libellé dépend du sens.
  const qui = (l: LienFiche) => (l.sens === "vers" ? [l.autre.nom, prenom] : [prenom, l.autre.nom]);

  return (
    <div className="flex flex-col gap-2">
      {erreur && (
        <p role="alert" className="text-sm text-erreur">
          {erreur}
        </p>
      )}
      <ul className="panneau divide-y divide-bordure text-sm">
        {liens.map((l) => {
          const [de, vers] = qui(l);
          return (
            <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <span className="min-w-40">
                <Link href={`/personnes/${l.autre.id}`} className="lien font-medium">
                  {l.autre.nom}
                </Link>
                <span className="block text-xs text-doux">{natureDuLien(l)}</span>
              </span>
              {l.autre.telephone && (
                <a href={`tel:${l.autre.telephone.replace(/\s/g, "")}`} className="lien tabular-nums">
                  {l.autre.telephone}
                </a>
              )}
              <span className="flex w-full flex-col items-start gap-2">
                <label className="flex items-center gap-1.5" title={`${de} paie les cours de ${vers}`}>
                  <input
                    type="checkbox"
                    checked={l.paiePour}
                    disabled={enCours}
                    onChange={(e) => agir(() => changerDrapeaux(l.id, l.type, { paiePour: e.target.checked, contactUrgence: l.contactUrgence }))}
                  />
                  {de} paie les cours de {vers}
                </label>
                <label className="flex items-center gap-1.5" title={`${de} est à prévenir en cas d’urgence pour ${vers}`}>
                  <input
                    type="checkbox"
                    checked={l.contactUrgence}
                    disabled={enCours}
                    onChange={(e) => agir(() => changerDrapeaux(l.id, l.type, { paiePour: l.paiePour, contactUrgence: e.target.checked }))}
                  />
                  {de} est à prévenir en cas d’urgence pour {vers}
                </label>
                {aRetirer === l.id ? (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-erreur px-2 py-0.5 text-xs text-erreur hover:bg-erreur/10"
                      disabled={enCours}
                      onClick={() => agir(() => retirerLien(l.id))}
                    >
                      Retirer le lien
                    </button>
                    <button type="button" className="lien text-xs" onClick={() => setARetirer(null)}>
                      Annuler
                    </button>
                  </span>
                ) : (
                  <button type="button" className="lien text-xs text-doux" onClick={() => setARetirer(l.id)} aria-label={`Retirer le lien avec ${l.autre.nom}`}>
                    Retirer
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

