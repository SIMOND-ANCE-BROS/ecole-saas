"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CoursPlanning } from "@/db/planning";
import type { SeancePlanning } from "@/db/seances";
import type { Horaire } from "@/domaine/planning/horaires";
import { ages, fin, JOURS, marqueRecurrence, recurrenceTexte } from "./format";
import { FILTRES_VIDES, filtrerPlanning } from "./filtres";
import { SemaineDatee } from "./semaine-datee";
import { SemaineType } from "./semaine-type";

export type VuePlanning = "datee" | "type" | "liste";
const VUES: Record<VuePlanning, string> = { datee: "Par semaine", type: "Semaine type", liste: "Liste" };

type Props = {
  cours: CoursPlanning[];
  /** Direction : chaque jour propose « + » pour créer un cours. */
  modifiable: boolean;
  /** Cours tout juste enregistré, signalé dans la grille. */
  misEnAvant?: string;
  /** Vue choisie (`?vue=`) : semaine datée par défaut (#90). */
  vue: VuePlanning;
  /** Semaine datée affichée : son lundi, ses séances et ses fermetures. */
  lundi: string;
  aujourdhui: string;
  seances: SeancePlanning[];
  fermetures: { libelle: string; debut: string; fin: string }[];
  /** Horaires d'ouverture par site (#90) : bornent l'agenda. */
  horaires: Record<string, Horaire[]>;
};

/** Planning de la semaine, filtrable par discipline, site, salle et intervenant, avec l'effectif de chaque cours. */
export function GrillePlanning({ cours, modifiable, misEnAvant, vue: vueInitiale, horaires, lundi, aujourdhui, seances, fermetures }: Props) {
  const [filtres, setFiltres] = useState(FILTRES_VIDES);
  const [vue, setVue] = useState(vueInitiale);
  const choisirVue = (v: VuePlanning) => {
    setVue(v);
    window.history.replaceState(null, "", v === "datee" ? `/planning?semaine=${lundi}` : `/planning?vue=${v}`);
  };
  const { discipline, site, salleId, intervenantId } = filtres;
  const disciplines = useMemo(() => [...new Set(cours.map((c) => c.discipline))].sort(), [cours]);
  const sites = useMemo(() => [...new Set(cours.map((c) => c.site))].sort(), [cours]);
  const salles = [...new Map(cours.filter((c) => !site || c.site === site).map((c) => [c.salleId, { id: c.salleId, libelle: `${c.salle} · ${c.site}` }])).values()].sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"));
  const intervenants = [...new Map(cours.map((c) => [c.intervenantId, c.intervenant])).entries()].sort((a, b) => a[1].localeCompare(b[1], "fr"));
  const visibles = filtrerPlanning(cours, filtres);
  const filtresActifs = Object.values(filtres).some(Boolean);
  // Horaires des sites affichés : le site (ou celui de la salle) filtré, sinon tous.
  const siteFiltre = salleId ? cours.find((c) => c.salleId === salleId)?.siteId : site ? cours.find((c) => c.site === site)?.siteId : undefined;
  const horairesAffiches = siteFiltre ? (horaires[siteFiltre] ?? []) : Object.values(horaires).flat();
  const jours = [...new Set(visibles.map((c) => c.jourSemaine))].sort((a, b) => (a ?? 8) - (b ?? 8));

  return (
    <div className="flex flex-col gap-4">
      <div className="panneau flex flex-wrap items-end gap-3 p-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-discipline" className="text-xs text-doux">
            Discipline
          </label>
          <select id="filtre-discipline" className="champ" value={discipline} onChange={(e) => setFiltres({ ...filtres, discipline: e.target.value })}>
            <option value="">Toutes</option>
            {disciplines.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-site" className="text-xs text-doux">
            Site
          </label>
          <select id="filtre-site" className="champ" value={site} onChange={(e) => setFiltres({ ...filtres, site: e.target.value, salleId: "" })}>
            <option value="">Tous</option>
            {sites.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-salle" className="text-xs text-doux">Salle</label>
          <select id="filtre-salle" className="champ" value={salleId} onChange={(e) => setFiltres({ ...filtres, salleId: e.target.value })}>
            <option value="">Toutes les salles</option>
            {salles.map((s) => <option key={s.id} value={s.id}>{s.libelle}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-intervenant" className="text-xs text-doux">Intervenant</label>
          <select id="filtre-intervenant" className="champ" value={intervenantId} onChange={(e) => setFiltres({ ...filtres, intervenantId: e.target.value })}>
            <option value="">Tous les intervenants</option>
            {intervenants.map(([id, nom]) => <option key={id} value={id}>{nom}</option>)}
          </select>
        </div>
        {filtresActifs && <button type="button" className="bouton-secondaire" onClick={() => setFiltres(FILTRES_VIDES)}>Réinitialiser les filtres</button>}
        <p className="pb-1.5 text-sm text-doux" aria-live="polite">
          {visibles.length} cours sur {cours.length}
        </p>
        <div role="group" aria-label="Affichage" className="ml-auto flex overflow-hidden rounded-md border border-bordure text-sm">
          {(Object.keys(VUES) as VuePlanning[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={vue === v}
              className={`px-3 py-1.5 ${vue === v ? "bg-accent text-sur-accent" : "hover:bg-accent-doux"}`}
              onClick={() => choisirVue(v)}
            >
              {VUES[v]}
            </button>
          ))}
        </div>
      </div>

      {visibles.length === 0 ? (
        <div className="panneau flex flex-col items-start gap-3 p-5"><p className="text-sm text-doux">{cours.length === 0 ? "Aucun cours n’est encore programmé." : "Aucun cours ne correspond à cette combinaison de filtres."}</p>{filtresActifs && <button type="button" className="bouton-secondaire" onClick={() => setFiltres(FILTRES_VIDES)}>Afficher tous les cours</button>}</div>
      ) : vue === "datee" ? (
        <SemaineDatee
          seances={filtrerPlanning(seances, filtres)}
          lundi={lundi}
          aujourdhui={aujourdhui}
          fermetures={fermetures}
          horaires={horairesAffiches}
          modifiable={modifiable}
        />
      ) : vue === "type" ? (
        <SemaineType cours={visibles} tous={cours} modifiable={modifiable} misEnAvant={misEnAvant} horaires={horairesAffiches} />
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
          {jours.map((jour) => (
            <section key={jour ?? "stage"} aria-labelledby={`jour-${jour ?? "stage"}`} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between border-b border-bordure pb-1">
                <h2 id={`jour-${jour ?? "stage"}`} className="text-sm font-semibold">
                  {jour ? JOURS[jour] : "À dates précises"}
                </h2>
                {modifiable && jour && (
                  <Link
                    href={`/planning/cours/nouveau?jour=${jour}`}
                    className="lien -my-1 px-2 py-1 text-base"
                    aria-label={`Nouveau cours le ${JOURS[jour].toLowerCase()}`}
                  >
                    +
                  </Link>
                )}
              </div>
              <ul className="flex flex-col gap-2">
                {visibles
                  .filter((c) => c.jourSemaine === jour)
                  .map((c) => {
                    const complet = c.capaciteMax !== null && c.inscrits >= c.capaciteMax;
                    const remplissage = c.capaciteMax ? Math.min(1, c.inscrits / c.capaciteMax) : 0;
                    return (
                      <li
                        key={c.id}
                        className={`panneau flex flex-col gap-0.5 px-2.5 py-2 text-sm ${c.id === misEnAvant ? "border-accent ring-1 ring-accent" : ""}`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-medium">
                            <span className="tabular-nums">
                              {c.heureDebut}–{fin(c.heureDebut, c.dureeMinutes)}
                            </span>{" "}
                            <Link href={`/planning/cours/${c.id}`} className="lien">
                              {c.discipline}
                            </Link>
                          </p>
                          {complet && (
                            <span className="rounded bg-alerte-fond px-1.5 text-xs font-medium text-alerte-texte">Complet</span>
                          )}
                        </div>
                        <p className="text-xs text-doux">
                          {c.salle}, {c.site} — {c.intervenant}
                        </p>
                        {(c.jourSemaine === null || marqueRecurrence(c)) && (
                          <p className="text-xs text-doux">{c.jourSemaine === null ? recurrenceTexte(c) : marqueRecurrence(c)}</p>
                        )}
                        {(ages(c.ageMin, c.ageMax) || c.niveau) && (
                          <p className="text-xs text-doux">{[ages(c.ageMin, c.ageMax), c.niveau].filter(Boolean).join(", ")}</p>
                        )}
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          {c.capaciteMax ? (
                            <>
                              <span
                                className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent-doux"
                                role="img"
                                aria-label={`${c.inscrits} inscrits sur ${c.capaciteMax} places`}
                              >
                                <span
                                  className={`block h-full rounded-full ${complet ? "bg-alerte-texte" : "bg-accent"}`}
                                  style={{ width: `${remplissage * 100}%` }}
                                />
                              </span>
                              <span className="tabular-nums text-doux">
                                {c.inscrits} / {c.capaciteMax}
                              </span>
                            </>
                          ) : (
                            <span className="text-doux">
                              {c.inscrits} inscrit{c.inscrits > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
