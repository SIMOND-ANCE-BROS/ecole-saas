"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CoursPlanning } from "@/db/planning";

const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function fin(heure: string, duree: number): string {
  const [h, m] = heure.split(":").map(Number);
  const total = h * 60 + m + duree;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function ages(min: number | null, max: number | null): string | null {
  if (min && max) return `${min} à ${max} ans`;
  if (min) return `dès ${min} ans`;
  if (max) return `jusqu’à ${max} ans`;
  return null;
}

type Props = {
  cours: CoursPlanning[];
  /** Direction : chaque cours mène à sa modification, chaque jour propose « + ». */
  modifiable: boolean;
  /** Cours tout juste enregistré, signalé dans la grille. */
  misEnAvant?: string;
};

/** Planning de la semaine, filtrable par discipline et par site, avec l'effectif de chaque cours. */
export function GrillePlanning({ cours, modifiable, misEnAvant }: Props) {
  const [discipline, setDiscipline] = useState("");
  const [site, setSite] = useState("");
  const disciplines = useMemo(() => [...new Set(cours.map((c) => c.discipline))].sort(), [cours]);
  const sites = useMemo(() => [...new Set(cours.map((c) => c.site))].sort(), [cours]);
  const visibles = cours.filter((c) => (!discipline || c.discipline === discipline) && (!site || c.site === site));
  const jours = [...new Set(visibles.map((c) => c.jourSemaine))];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-discipline" className="text-xs text-doux">
            Discipline
          </label>
          <select id="filtre-discipline" className="champ" value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
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
          <select id="filtre-site" className="champ" value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">Tous</option>
            {sites.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <p className="pb-1.5 text-sm text-doux" aria-live="polite">
          {visibles.length} cours
        </p>
      </div>

      {visibles.length === 0 ? (
        <p className="text-sm text-doux">Aucun cours ne correspond à ces filtres.</p>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
          {jours.map((jour) => (
            <section key={jour ?? "stage"} aria-labelledby={`jour-${jour ?? "stage"}`} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between border-b border-bordure pb-1">
                <h2 id={`jour-${jour ?? "stage"}`} className="text-sm font-semibold">
                  {jour ? JOURS[jour] : "Stages"}
                </h2>
                {modifiable && jour && (
                  <Link
                    href={`/planning/cours/nouveau?jour=${jour}`}
                    className="lien px-1 text-sm"
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
                            {modifiable ? (
                              <Link href={`/planning/cours/${c.id}/modifier`} className="lien">
                                {c.discipline}
                              </Link>
                            ) : (
                              c.discipline
                            )}
                          </p>
                          {complet && (
                            <span className="rounded bg-alerte-fond px-1.5 text-xs font-medium text-alerte-texte">Complet</span>
                          )}
                        </div>
                        <p className="text-xs text-doux">
                          {c.salle}, {c.site} — {c.intervenant}
                        </p>
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
