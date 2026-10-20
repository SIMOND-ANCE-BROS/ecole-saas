"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { type Condition, type DefColonne, type Filtre, lireFiltre, OPERATEURS, sansValeur, valeurNormalisee, versParametres } from "@/domaine/filtres/filtres";

/** Délai avant d'appliquer une valeur tapée (la liste se recharge depuis le serveur). */
const DELAI = 350;

/**
 * Filtre d'une liste (#87, #89) : état local, dont seules les conditions
 * complètes vont dans l'adresse (`?f=…&mode=ou`) que la page relit côté
 * serveur. Une condition en cours de saisie reste locale.
 */
export function useFiltreAdresse(colonnes: DefColonne[]) {
  const router = useRouter();
  const chemin = usePathname();
  const params = useSearchParams();
  const [enCours, demarrer] = useTransition();
  const [filtre, setFiltre] = useState<Filtre>(() => lireFiltre(params.getAll("f"), params.get("mode"), colonnes));
  const minuteur = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(minuteur.current), []);

  const typeDe = (colonne: string) => colonnes.find((c) => c.id === colonne)?.type ?? "texte";
  const complete = (c: Condition) => valeurNormalisee(c, typeDe(c.colonne)) !== null;

  function publier(f: Filtre, differe = false) {
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

  /** Change le filtre ; `differe` pour une valeur en cours de frappe. */
  function changer(f: Filtre, differe = false) {
    setFiltre(f);
    publier(f, differe);
  }

  /** Modifie la condition d'indice `i` (opérateur adapté au type de la colonne, valeur vidée si inutile). */
  function modifier(i: number, maj: Partial<Condition>) {
    const conditions = filtre.conditions.map((c, j) => {
      if (j !== i) return c;
      const suivante = { ...c, ...maj };
      const ops = OPERATEURS[typeDe(suivante.colonne)];
      if (!ops.includes(suivante.operateur)) suivante.operateur = ops[0];
      if (sansValeur(suivante.operateur)) suivante.valeur = "";
      return suivante;
    });
    changer({ ...filtre, conditions }, "valeur" in maj);
  }

  /** Nouvelle condition vide sur une colonne : rien à recharger tant qu'elle n'a pas de valeur. */
  function ajouter(colonne: string) {
    setFiltre({ ...filtre, conditions: [...filtre.conditions, { colonne, operateur: OPERATEURS[typeDe(colonne)][0], valeur: "" }] });
  }

  function retirer(i: number) {
    changer({ ...filtre, conditions: filtre.conditions.filter((_, j) => j !== i) });
  }

  /** À la fermeture d'une bulle : oublie les conditions de cette colonne restées sans valeur (jamais publiées). */
  function nettoyer(colonne: string) {
    setFiltre((f) => ({ ...f, conditions: f.conditions.filter((c) => c.colonne !== colonne || complete(c)) }));
  }

  return { filtre, enCours, typeDe, complete, changer, modifier, ajouter, retirer, nettoyer, appliquer: () => publier(filtre) };
}

export type FiltreAdresse = ReturnType<typeof useFiltreAdresse>;
