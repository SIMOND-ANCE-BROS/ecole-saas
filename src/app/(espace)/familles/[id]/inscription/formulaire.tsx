"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Apercu } from "@/db/inscriptions";
import type { CoursPlanning } from "@/db/planning";
import { formaterEuros } from "@/lib/montant";
import { apercu, inscrire, type SaisieFormulaire } from "./actions";

const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const PUBLICS = [
  ["enfant", "Enfant"],
  ["adulte", "Adulte"],
  ["couple", "Couple"],
  ["etudiant", "Étudiant"],
] as const;
const PERIODICITES = [
  ["trimestre", "Trimestre"],
  ["annee", "Année"],
] as const;

type Props = {
  payeurId: string;
  danseurs: { id: string; prenom: string; age: number | null }[];
  cours: CoursPlanning[];
};

export function FormulaireInscription({ payeurId, danseurs, cours }: Props) {
  const [danseurIds, setDanseurIds] = useState<string[]>(danseurs.length === 1 ? [danseurs[0].id] : []);
  const [publicChoisi, setPublic] = useState<SaisieFormulaire["public"]>(
    danseurs.length === 1 && danseurs[0].age !== null && danseurs[0].age >= 18 ? "adulte" : "enfant",
  );
  const [periodicite, setPeriodicite] = useState<SaisieFormulaire["periodicite"]>("trimestre");
  const [coursIds, setCoursIds] = useState<string[]>([]);
  const [filtre, setFiltre] = useState("");
  const [dernierApercu, setApercu] = useState<Apercu | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [calcul, demarrerCalcul] = useTransition();
  const [envoi, demarrerEnvoi] = useTransition();

  const saisie: SaisieFormulaire = useMemo(
    () => ({ payeurId, danseurIds, public: publicChoisi, periodicite, coursIds }),
    [payeurId, danseurIds, publicChoisi, periodicite, coursIds],
  );

  // Aperçu recalculé côté serveur après une courte pause ; rien tant qu'aucun danseur n'est choisi.
  useEffect(() => {
    if (danseurIds.length === 0) return;
    const minuteur = setTimeout(() => demarrerCalcul(async () => setApercu(await apercu(saisie))), 150);
    return () => clearTimeout(minuteur);
  }, [saisie, danseurIds.length]);
  const resultat = danseurIds.length > 0 ? dernierApercu : null;

  const basculer = (liste: string[], id: string) => (liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id]);
  const coursVisibles = cours.filter((c) =>
    `${c.discipline} ${c.niveau ?? ""} ${JOURS[c.jourSemaine ?? 0]}`.toLowerCase().includes(filtre.trim().toLowerCase()),
  );
  const nouvelle = resultat?.statut === "ok" ? resultat.nouvelle : null;
  const peutEnregistrer = nouvelle?.statut === "ok" && !envoi;

  return (
    <form
      className="grid gap-6 lg:grid-cols-[1fr_22rem]"
      onSubmit={(e) => {
        e.preventDefault();
        setRefus(null);
        demarrerEnvoi(async () => setRefus((await inscrire(saisie)).message));
      }}
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-semibold">Danseur{publicChoisi === "couple" ? "s (deux)" : ""}</legend>
          {danseurs.map((d) => (
            <label key={d.id} className="flex items-center gap-2 text-sm">
              <input
                type={publicChoisi === "couple" ? "checkbox" : "radio"}
                name="danseur"
                checked={danseurIds.includes(d.id)}
                onChange={() => setDanseurIds(publicChoisi === "couple" ? basculer(danseurIds, d.id) : [d.id])}
              />
              {d.prenom}
              {d.age !== null && <span className="text-neutral-600 dark:text-neutral-400">({d.age} ans)</span>}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="public" className="text-sm font-semibold">Public</label>
            <select
              id="public"
              className="champ"
              value={publicChoisi}
              onChange={(e) => {
                const valeur = e.target.value as SaisieFormulaire["public"];
                setPublic(valeur);
                if (valeur !== "couple") setDanseurIds(danseurIds.slice(0, 1));
              }}
            >
              {PUBLICS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="periodicite" className="text-sm font-semibold">Périodicité</label>
            <select
              id="periodicite"
              className="champ"
              value={periodicite}
              onChange={(e) => setPeriodicite(e.target.value as SaisieFormulaire["periodicite"])}
            >
              {PERIODICITES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold">Cours ({coursIds.length} choisi{coursIds.length > 1 ? "s" : ""})</legend>
          <label className="sr-only" htmlFor="filtre-cours">Filtrer les cours</label>
          <input
            id="filtre-cours"
            type="search"
            className="champ max-w-xs"
            placeholder="Filtrer : jazz, mercredi, adultes…"
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
          />
          <ul className="flex max-h-96 flex-col overflow-y-auto rounded border border-neutral-300 dark:border-neutral-700">
            {coursVisibles.map((c) => (
              <li key={c.id} className="border-b border-neutral-200 last:border-0 dark:border-neutral-800">
                <label className="flex items-center gap-2 px-2 py-1 text-sm">
                  <input type="checkbox" checked={coursIds.includes(c.id)} onChange={() => setCoursIds(basculer(coursIds, c.id))} />
                  <span className="w-20 shrink-0">{c.jourSemaine ? JOURS[c.jourSemaine] : "Stage"}</span>
                  <span className="w-12 shrink-0 tabular-nums">{c.heureDebut}</span>
                  <span className="font-medium">{c.discipline}</span>
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {c.dureeMinutes} min{c.niveau ? ` · ${c.niveau}` : ""} · {c.salle}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>

      <aside aria-live="polite" className="flex flex-col gap-3 self-start rounded border border-neutral-300 p-3 text-sm dark:border-neutral-700">
        <h2 className="font-semibold">Prix {calcul && <span className="font-normal text-neutral-600">· calcul…</span>}</h2>
        {!resultat && <p className="text-neutral-600 dark:text-neutral-400">Choisissez un danseur et des cours.</p>}
        {resultat?.statut === "invalide" && <p role="alert">{resultat.message}</p>}
        {nouvelle?.statut === "erreur" && <p role="alert">{nouvelle.erreur.message}</p>}
        {nouvelle?.statut === "ok" && (
          <dl className="flex flex-col gap-1">
            <div className="flex justify-between gap-2">
              <dt>Forfait {nouvelle.libelleForfait}</dt>
              <dd className="tabular-nums">{formaterEuros(nouvelle.prixBrutCentimes)}</dd>
            </div>
            {nouvelle.reductions.map((r) => (
              <div key={r.code} className={r.statut === "ecartee" ? "text-neutral-600 dark:text-neutral-400" : ""}>
                <div className="flex justify-between gap-2">
                  <dt>Réduction {r.code}{r.statut === "ecartee" ? " (écartée)" : ""}</dt>
                  <dd className="tabular-nums">{r.statut === "appliquee" ? `−${formaterEuros(r.montantCentimes)}` : "—"}</dd>
                </div>
                <p className="text-xs">{r.motif}</p>
              </div>
            ))}
            <div className="mt-1 flex justify-between gap-2 border-t border-neutral-300 pt-1 font-semibold dark:border-neutral-700">
              <dt>Total</dt>
              <dd className="tabular-nums">{formaterEuros(nouvelle.prixNetCentimes)}</dd>
            </div>
          </dl>
        )}
        {resultat?.statut === "ok" &&
          resultat.autres.map((a) => (
            <p key={a.reference} className="rounded bg-amber-100 p-2 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
              L’inscription déjà enregistrée de {a.danseurs} aurait une remise de {formaterEuros(a.remiseRecalculee)} au lieu de{" "}
              {formaterEuros(a.remiseEnregistree)} : à régulariser par un avoir si l’école le décide.
            </p>
          ))}
        {refus && <p role="alert" className="text-red-700 dark:text-red-400">{refus}</p>}
        <button type="submit" className="bouton-principal" disabled={!peutEnregistrer}>
          {envoi ? "Enregistrement…" : "Enregistrer l’inscription"}
        </button>
      </aside>
    </form>
  );
}
