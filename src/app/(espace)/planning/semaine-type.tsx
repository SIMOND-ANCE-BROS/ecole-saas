"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CoursPlanning } from "@/db/planning";
import { versHeure } from "@/domaine/planning/agenda";
import { cadreAgenda, type Horaire } from "@/domaine/planning/horaires";
import { Agenda, type Creneau, type ElementAgenda, type RetourAgenda } from "./agenda";
import { deplacer } from "./cours/actions";
import { fin, JOURS, marqueRecurrence, recurrenceTexte } from "./format";

type Props = {
  /** Cours visibles (filtres appliqués). */
  cours: CoursPlanning[];
  /** Tous les cours de la saison : plage horaire stable quels que soient les filtres. */
  tous: CoursPlanning[];
  modifiable: boolean;
  misEnAvant?: string;
  horaires: Horaire[];
};

/**
 * Semaine type de la saison (#79) : les cours réguliers à leur jour et leur
 * heure ; déplacer un cours change le cours (et ses séances à venir). Les
 * cours à dates précises sont listés dessous.
 */
export function SemaineType({ cours, tous, modifiable, misEnAvant, horaires }: Props) {
  const router = useRouter();
  const reguliers = cours.filter((c) => c.jourSemaine !== null);
  const ponctuels = cours.filter((c) => c.jourSemaine === null);
  const { jours, debut, fin: finJournee } = cadreAgenda(horaires, tous);

  const elements: ElementAgenda[] = reguliers.map((c) => ({
    id: c.id,
    jourSemaine: c.jourSemaine as number,
    heureDebut: c.heureDebut,
    dureeMinutes: c.dureeMinutes,
    titre: c.discipline,
    lignes: [`${c.salle} · ${c.intervenant}`, `${c.inscrits}${c.capaciteMax ? ` / ${c.capaciteMax}` : ""} inscrit${c.inscrits > 1 ? "s" : ""}`],
    etiquette: marqueRecurrence(c),
    alerte: c.capaciteMax !== null && c.inscrits >= c.capaciteMax ? "complet" : null,
    href: `/planning/cours/${c.id}`,
    deplacable: true,
  }));

  const quand = (c: Creneau) => `${JOURS[c.jourSemaine].toLowerCase()} ${c.heureDebut}–${fin(c.heureDebut, c.dureeMinutes)}`;
  async function deplacerCours(id: string, creneau: Creneau, choix: string | null): Promise<RetourAgenda> {
    const c = cours.find((x) => x.id === id);
    const r = await deplacer(id, creneau, choix === "oui");
    if (r.statut === "confirmer") {
      return {
        statut: "choisir",
        question: `${c?.discipline} compte ${r.inscrits} élève${r.inscrits > 1 ? "s" : ""} inscrit${r.inscrits > 1 ? "s" : ""}. Passer au ${quand(creneau)} ? Les séances à venir suivent ; pensez à prévenir les familles.`,
        choix: [{ valeur: "oui", libelle: "Déplacer le cours" }],
      };
    }
    if (r.statut === "refus") return r;
    return { statut: "ok", texte: `Cours déplacé — ${c?.discipline ?? "Cours"} : ${quand(creneau)}.`, alertes: r.alertes };
  }

  return (
    <div className="flex flex-col gap-3">
      <Agenda
        elements={elements}
        colonnes={jours.map((j) => ({ jour: j, titre: JOURS[j] }))}
        debut={debut}
        fin={finJournee}
        horaires={horaires}
        modifiable={modifiable}
        misEnAvant={misEnAvant}
        deplacer={deplacerCours}
        creer={(jour, d, duree) => router.push(`/planning/cours/nouveau?jour=${jour}&heure=${versHeure(d)}&duree=${duree}`)}
      />
      {ponctuels.length > 0 && (
        <section aria-labelledby="agenda-ponctuels" className="flex flex-col gap-1">
          <h2 id="agenda-ponctuels" className="text-sm font-semibold">
            À dates précises (stages, cours exceptionnels)
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {ponctuels.map((s) => (
              <li key={s.id} className="panneau px-2.5 py-1.5">
                <Link href={`/planning/cours/${s.id}`} className="lien font-medium">
                  {s.discipline}
                </Link>{" "}
                <span className="text-doux">
                  {s.heureDebut}–{fin(s.heureDebut, s.dureeMinutes)}, {s.salle} — {recurrenceTexte(s)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
