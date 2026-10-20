"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  CONDITIONS_MAX,
  type Condition,
  type DefColonne,
  type Filtre,
  LIBELLES_OPERATEURS,
  lireFiltre,
  type Mode,
  OPERATEURS,
  sansValeur,
  valeurNormalisee,
  versParametres,
} from "@/domaine/filtres/filtres";

type Props = { colonnes: DefColonne[]; /** « les élèves », « les contacts »… */ quoi: string };

/** Délai avant d'appliquer une valeur tapée (la liste se recharge depuis le serveur). */
const DELAI = 350;

/**
 * Filtres par colonne d'une liste (#87) : une ligne par condition (colonne,
 * opérateur, valeur), combinées par « toutes » (ET) ou « au moins une » (OU).
 * Les conditions complètes vont dans l'adresse (`?f=…&mode=ou`), que la page
 * relit côté serveur ; une condition encore incomplète reste ici.
 */
export function BarreFiltres({ colonnes, quoi }: Props) {
  const router = useRouter();
  const chemin = usePathname();
  const params = useSearchParams();
  const [enCours, demarrer] = useTransition();
  const [filtre, setFiltre] = useState<Filtre>(() => lireFiltre(params.getAll("f"), params.get("mode"), colonnes));
  const lignes = useRef(new Map<number, HTMLSelectElement>());
  const aFocaliser = useRef<number | null>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout>>(undefined);

  const typeDe = (colonne: string) => colonnes.find((c) => c.id === colonne)?.type ?? "texte";
  const complete = (c: Condition) => valeurNormalisee(c, typeDe(c.colonne)) !== null;

  // Écrit les conditions complètes dans l'adresse, en gardant les autres paramètres (recherche…).
  function publier(f: Filtre, differe: boolean) {
    clearTimeout(minuteur.current);
    const envoyer = () => {
      const p = new URLSearchParams(params.toString());
      p.delete("f");
      p.delete("mode");
      for (const [cle, valeur] of versParametres({ ...f, conditions: f.conditions.filter(complete) })) p.append(cle, valeur);
      const texte = p.toString();
      demarrer(() => router.replace(texte ? `${chemin}?${texte}` : chemin, { scroll: false }));
    };
    if (differe) minuteur.current = setTimeout(envoyer, DELAI);
    else envoyer();
  }
  useEffect(() => () => clearTimeout(minuteur.current), []);

  useEffect(() => {
    if (aFocaliser.current === null) return;
    lignes.current.get(aFocaliser.current)?.focus();
    aFocaliser.current = null;
  });

  function changer(f: Filtre, differe = false) {
    setFiltre(f);
    publier(f, differe);
  }
  function modifier(i: number, maj: Partial<Condition>) {
    const conditions = filtre.conditions.map((c, j) => {
      if (j !== i) return c;
      const suivante = { ...c, ...maj };
      // Nouvelle colonne d'un autre type : premier opérateur adapté.
      if (!OPERATEURS[typeDe(suivante.colonne)].includes(suivante.operateur)) suivante.operateur = OPERATEURS[typeDe(suivante.colonne)][0];
      if (sansValeur(suivante.operateur)) suivante.valeur = "";
      return suivante;
    });
    changer({ ...filtre, conditions }, "valeur" in maj);
  }
  function ajouter() {
    const colonne = colonnes[0];
    aFocaliser.current = filtre.conditions.length;
    // Une condition vide ne filtre rien : inutile de recharger la liste.
    setFiltre({ ...filtre, conditions: [...filtre.conditions, { colonne: colonne.id, operateur: OPERATEURS[colonne.type][0], valeur: "" }] });
  }
  function retirer(i: number) {
    const conditions = filtre.conditions.filter((_, j) => j !== i);
    aFocaliser.current = conditions.length > 0 ? Math.min(i, conditions.length - 1) : null;
    changer({ ...filtre, conditions });
  }

  const n = filtre.conditions.length;
  return (
    <div className="panneau flex flex-col gap-2 p-3 text-sm" role="group" aria-label={`Filtrer ${quoi}`}>
      {n > 1 && (
        <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <legend className="float-left mr-1 text-doux">Afficher {quoi} qui remplissent</legend>
          {(["et", "ou"] as Mode[]).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input type="radio" name="mode-filtres" checked={filtre.mode === m} onChange={() => changer({ ...filtre, mode: m })} />
              {m === "et" ? "toutes les conditions" : "au moins une condition"}
            </label>
          ))}
        </fieldset>
      )}
      {filtre.conditions.map((c, i) => {
        const type = typeDe(c.colonne);
        const incomplete = !sansValeur(c.operateur) && !complete(c) && c.valeur.trim() !== "";
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            {n > 1 && (
              <span className="w-6 text-xs text-doux" aria-hidden>
                {i === 0 ? "" : filtre.mode === "et" ? "et" : "ou"}
              </span>
            )}
            <label className="sr-only" htmlFor={`filtre-colonne-${i}`}>
              Colonne du filtre {i + 1}
            </label>
            <select
              id={`filtre-colonne-${i}`}
              ref={(el) => {
                if (el) lignes.current.set(i, el);
                else lignes.current.delete(i);
              }}
              className="champ"
              value={c.colonne}
              onChange={(e) => modifier(i, { colonne: e.target.value })}
            >
              {colonnes.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.libelle}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor={`filtre-operateur-${i}`}>
              Condition du filtre {i + 1}
            </label>
            <select id={`filtre-operateur-${i}`} className="champ" value={c.operateur} onChange={(e) => modifier(i, { operateur: e.target.value as Condition["operateur"] })}>
              {OPERATEURS[type].map((o) => (
                <option key={o} value={o}>
                  {LIBELLES_OPERATEURS[o]}
                </option>
              ))}
            </select>
            {!sansValeur(c.operateur) && (
              <>
                <label className="sr-only" htmlFor={`filtre-valeur-${i}`}>
                  Valeur du filtre {i + 1}
                </label>
                <input
                  id={`filtre-valeur-${i}`}
                  className="champ w-40"
                  inputMode={type === "texte" ? "text" : type === "nombre" ? "decimal" : "tel"}
                  value={c.valeur}
                  aria-invalid={incomplete || undefined}
                  aria-describedby={incomplete ? `filtre-aide-${i}` : undefined}
                  onChange={(e) => modifier(i, { valeur: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      publier(filtre, false);
                    }
                  }}
                />
              </>
            )}
            <button type="button" className="bouton-secondaire" onClick={() => retirer(i)} aria-label={`Retirer le filtre ${i + 1}`}>
              Retirer
            </button>
            {incomplete && (
              <span id={`filtre-aide-${i}`} className="text-xs text-erreur">
                {type === "nombre" ? "Saisissez un nombre." : "Saisissez des chiffres."}
              </span>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="bouton-secondaire" onClick={ajouter} disabled={n >= CONDITIONS_MAX}>
          {n === 0 ? "Filtrer par colonne" : "Ajouter une condition"}
        </button>
        {n > 0 && (
          <button type="button" className="lien text-sm" onClick={() => changer({ mode: "et", conditions: [] })}>
            Effacer les filtres
          </button>
        )}
        {enCours && (
          <span className="text-xs text-doux" role="status">
            Filtrage…
          </span>
        )}
      </div>
    </div>
  );
}
