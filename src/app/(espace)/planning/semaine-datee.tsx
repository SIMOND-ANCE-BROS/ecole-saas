"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SeancePlanning } from "@/db/seances";
import { versHeure } from "@/domaine/planning/agenda";
import { cadreAgenda, type Horaire } from "@/domaine/planning/horaires";
import { ajouterJours, joursDeLaSemaine, jourSemaineDe } from "@/domaine/planning/semaine";
import { deplacerUneSeance } from "./actions";
import { Agenda, type Creneau, type ElementAgenda, type RetourAgenda } from "./agenda";
import { dateCourte, fin } from "./format";

type Props = {
  /** Séances visibles de la semaine (filtres appliqués). */
  seances: SeancePlanning[];
  /** Lundi de la semaine affichée. */
  lundi: string;
  aujourdhui: string;
  fermetures: { libelle: string; debut: string; fin: string }[];
  horaires: Horaire[];
  modifiable: boolean;
};

const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Planning daté, semaine par semaine (#90) : les vraies séances (déplacées,
 * remplacées, annulées) et les fermetures. Déplacer une séance d'un cours
 * régulier demande « cette séance seulement » ou « cette séance et les
 * suivantes ».
 */
export function SemaineDatee({ seances, lundi, aujourdhui, fermetures, horaires, modifiable }: Props) {
  const router = useRouter();
  const dates = joursDeLaSemaine(lundi);
  const lienSemaine = (l: string) => `/planning?semaine=${l}`;

  const elements: ElementAgenda[] = seances.map((s) => ({
    id: s.id,
    jourSemaine: jourSemaineDe(s.date),
    heureDebut: s.heureDebut,
    dureeMinutes: s.dureeMinutes,
    titre: s.discipline,
    lignes: [`${s.salle} · ${s.intervenant}`, `${s.inscrits}${s.capaciteMax ? ` / ${s.capaciteMax}` : ""} inscrit${s.inscrits > 1 ? "s" : ""}`],
    etiquette: [s.deplacee && "déplacée", s.recurrence === "dates" && "ponctuel", s.recurrence === "quinzaine" && "1 sem. sur 2"].filter(Boolean).join(", ") || null,
    alerte: s.statut === "annulee" ? "annulée" : s.remplacement ? "remplacement" : null,
    barre: s.statut === "annulee",
    href: `/planning/seances/${s.id}`,
    deplacable: s.statut === "prevue",
  }));
  const { jours, debut, fin: finJournee } = cadreAgenda(horaires, elements);
  const fermeLe = (date: string) => fermetures.find((f) => f.debut <= date && date <= f.fin)?.libelle ?? null;

  async function deplacerSeance(id: string, creneau: Creneau, choix: string | null): Promise<RetourAgenda> {
    const s = seances.find((x) => x.id === id);
    const date = dates[creneau.jourSemaine - 1];
    const quand = `${dateCourte(date, true)} ${creneau.heureDebut}–${fin(creneau.heureDebut, creneau.dureeMinutes)}`;
    // Cours ponctuel : seule la séance existe ; cours régulier : demander la portée.
    if (!choix && s?.recurrence !== "dates") {
      return {
        statut: "choisir",
        question: `Déplacer ${s?.discipline ?? "la séance"} au ${quand} :`,
        choix: [
          { valeur: "seance", libelle: "Cette séance seulement" },
          { valeur: "suivantes", libelle: "Cette séance et les suivantes" },
        ],
      };
    }
    return deplacerUneSeance(id, { date, heureDebut: creneau.heureDebut, dureeMinutes: creneau.dureeMinutes }, choix === "suivantes" ? "suivantes" : "seance");
  }

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Semaines" className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={lienSemaine(ajouterJours(lundi, -7))} className="bouton-secondaire" aria-label="Semaine précédente">
          ←
        </Link>
        <Link href={lienSemaine(ajouterJours(lundi, 7))} className="bouton-secondaire" aria-label="Semaine suivante">
          →
        </Link>
        <Link href={lienSemaine(ajouterJours(aujourdhui, 1 - jourSemaineDe(aujourdhui)))} className="bouton-secondaire">
          Cette semaine
        </Link>
        <h2 className="font-semibold">
          Semaine du {dateCourte(lundi)} au {dateCourte(dates[6])} {dates[6].slice(0, 4)}
        </h2>
        <label className="ml-auto flex items-center gap-2">
          <span className="text-doux">Aller au</span>
          <input type="date" className="champ" defaultValue={lundi} onChange={(e) => e.target.value && router.push(lienSemaine(e.target.value))} />
        </label>
      </nav>
      {seances.length === 0 && <p className="text-sm text-doux">Aucune séance cette semaine.</p>}
      <Agenda
        elements={elements}
        colonnes={jours.map((j) => ({ jour: j, titre: majuscule(dateCourte(dates[j - 1], true)), ferme: fermeLe(dates[j - 1]) }))}
        debut={debut}
        fin={finJournee}
        horaires={horaires}
        modifiable={modifiable}
        deplacer={deplacerSeance}
        creer={(jour, d, duree) => router.push(`/planning/cours/nouveau?jour=${jour}&heure=${versHeure(d)}&duree=${duree}&date=${dates[jour - 1]}`)}
      />
    </div>
  );
}
