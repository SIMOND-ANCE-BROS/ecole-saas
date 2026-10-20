"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { requeteDifferee } from "@/lib/requete-differee";
import type { ResultatPersonne } from "@/db/personnes";
import { nomAffiche } from "@/domaine/personnes/nom";
import { chercherPersonnes, lierExistante } from "../../../actions";
import { RELATIONS, type Relation } from "../../../relations";

type Props = { ficheId: string; ficheNom: string };

/** Choix de la relation, puis d'une personne existante, ou création d'une nouvelle personne déjà liée. */
export function ChoixLien({ ficheId, ficheNom }: Props) {
  const [relation, setRelation] = useState<Relation>("representant");
  const [saisie, setSaisie] = useState("");
  const [reponse, setReponse] = useState<{ saisie: string; essai: number; resultats: ResultatPersonne[]; erreur: boolean } | null>(null);
  const [essai, setEssai] = useState(0);
  const actuelle = reponse?.saisie === saisie && reponse.essai === essai ? reponse : null;
  const resultats = actuelle?.resultats ?? [];
  const rechercheActive = saisie.trim().length >= 2;
  const [choisie, setChoisie] = useState<ResultatPersonne | null>(null);
  const [paiePour, setPaiePour] = useState(true);
  const [contactUrgence, setContactUrgence] = useState(true);
  const [refus, setRefus] = useState<string | null>(null);
  const [envoi, demarrer] = useTransition();

  useEffect(() => {
    if (saisie.trim().length < 2) return;
    return requeteDifferee(
      () => chercherPersonnes(saisie),
      (resultats) => setReponse({ saisie, essai, resultats: resultats.filter((r) => r.id !== ficheId), erreur: false }),
      () => setReponse({ saisie, essai, resultats: [], erreur: true }),
    );
  }, [saisie, ficheId, essai]);

  const r = RELATIONS[relation];
  const autre = choisie ? nomAffiche(choisie) : "l’autre personne";
  const [de, vers] = r.de === "fiche" ? [ficheNom, autre] : [autre, ficheNom];

  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <fieldset className="flex flex-col gap-1.5 text-sm">
        <legend className="mb-1 text-sm font-semibold">Pour {ficheNom}, l’autre personne est :</legend>
        {Object.entries(RELATIONS).map(([k, rel]) => (
          <label key={k} className="flex items-center gap-2">
            <input
              type="radio"
              name="relation"
              checked={relation === k}
              onChange={() => {
                setRelation(k as Relation);
                // Un représentant légal paie et est prévenu en cas d'urgence, sauf avis contraire.
                setPaiePour(rel.type === "representant_legal");
                setContactUrgence(rel.type === "representant_legal");
              }}
            />
            {rel.libelle}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="cherche" className="text-sm font-semibold">
          Personne déjà connue
        </label>
        <input
          id="cherche"
          type="search"
          className="champ"
          autoFocus
          autoComplete="off"
          placeholder="Nom, prénom, téléphone…"
          value={saisie}
          onChange={(e) => {
            setSaisie(e.target.value);
            setChoisie(null);
            setRefus(null);
          }}
        />
        {/* Région toujours présente : son contenu change, et les lecteurs d'écran l'annoncent. */}
        <div role="status" className="text-sm text-doux">
          {!choisie &&
            (!rechercheActive ? (
              "Saisissez au moins deux caractères."
            ) : !actuelle ? (
              "Recherche…"
            ) : actuelle.erreur ? (
              <span>
                Recherche indisponible.{" "}
                <button type="button" className="lien" onClick={() => setEssai((n) => n + 1)}>
                  Réessayer
                </button>
              </span>
            ) : resultats.length === 0 ? (
              "Aucune personne trouvée."
            ) : (
              `${resultats.length} résultat${resultats.length > 1 ? "s" : ""}`
            ))}
        </div>
        {rechercheActive && resultats.length > 0 && !choisie && (
          <ul className="panneau max-h-64 divide-y divide-bordure overflow-y-auto text-sm">
            {resultats.map((p) => (
              <li key={p.id}>
                <button type="button" className="flex w-full flex-wrap gap-x-3 px-3 py-1.5 text-left hover:bg-accent-doux/40" onClick={() => setChoisie(p)}>
                  <span className="font-medium">{nomAffiche(p)}</span>
                  {p.telephone && <span className="tabular-nums text-doux">{p.telephone}</span>}
                  {p.liees.length > 0 && <span className="text-doux">liée à {p.liees.join(", ")}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm">
          Elle n’existe pas encore ?{" "}
          <Link href={`/personnes/nouvelle?lien=${ficheId}&relation=${relation}`} className="lien">
            Créer une nouvelle personne liée à {ficheNom}
          </Link>
        </p>
      </div>

      {choisie && (
        <form
          className="panneau flex flex-col gap-2 p-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            demarrer(async () => setRefus((await lierExistante(ficheId, choisie.id, relation, { paiePour, contactUrgence })).message));
          }}
        >
          <p className="font-medium">
            {nomAffiche(choisie)}, {r.libelle} de {ficheNom}
          </p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={paiePour} onChange={(e) => setPaiePour(e.target.checked)} />
            {de} paie les cours de {vers}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={contactUrgence} onChange={(e) => setContactUrgence(e.target.checked)} />
            {de} est à prévenir en cas d’urgence pour {vers}
          </label>
          {refus && (
            <p role="alert" className="text-erreur">
              {refus}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className="bouton-principal" disabled={envoi}>
              {envoi ? "Enregistrement…" : "Ajouter le lien"}
            </button>
            <button type="button" className="bouton-secondaire" onClick={() => setChoisie(null)}>
              Choisir une autre personne
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
