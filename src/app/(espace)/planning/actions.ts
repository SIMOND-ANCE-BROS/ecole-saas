"use server";

import { revalidatePath } from "next/cache";
import { avecEcole } from "@/db";
import { horairesParSite } from "@/db/parametres";
import { deplacerSeance, seancesDeLaSemaine, synchroniserSeances } from "@/db/seances";
import { conflits } from "@/domaine/planning/chevauchement";
import { horsHoraires } from "@/domaine/planning/horaires";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { jourSemaineDe, lundiDe } from "@/domaine/planning/semaine";
import { exigerRole } from "@/lib/session";
import type { RetourAgenda } from "./agenda";
import { dateCourte, fin } from "./format";

/**
 * Déplace une séance du planning daté (#90) : « seance » (elle seule) ou
 * « suivantes » (le cours change à partir d'elle). Signale ensuite une salle
 * ou un intervenant déjà pris ce jour-là et un créneau hors des horaires du
 * site.
 */
export async function deplacerUneSeance(
  seanceId: string,
  creneau: { date: string; heureDebut: string; dureeMinutes: number },
  portee: "seance" | "suivantes",
): Promise<RetourAgenda> {
  const { ecoleId } = await exigerRole("direction");
  const aujourdhui = aujourdhuiAParis();
  const r = await avecEcole(ecoleId, async (tx): Promise<RetourAgenda> => {
    const d = await deplacerSeance(tx, seanceId, creneau, portee);
    if (d.statut === "refus") return d;
    if (d.depuis) await synchroniserSeances(tx, d.saisonId, aujourdhui, d.depuis);

    const semaine = await seancesDeLaSemaine(tx, lundiDe(creneau.date));
    const jour = semaine
      .filter((s) => s.date === creneau.date && s.statut !== "annulee")
      .map((s) => ({ ...s, jourSemaine: jourSemaineDe(s.date) }));
    const moi = jour.find(
      (s) => s.coursId === semaine.find((x) => x.id === seanceId)?.coursId && s.heureDebut === creneau.heureDebut,
    );
    const alertes: string[] = [];
    if (moi) {
      for (const x of conflits(moi, jour)) {
        const autre = jour.find((s) => s.id === x.id)!;
        const quand = `${autre.discipline} à ${autre.heureDebut}`;
        alertes.push(
          x.salle && x.intervenant
            ? `${autre.salle} et ${autre.intervenant} déjà pris (${quand})`
            : x.salle
              ? `${autre.salle} déjà occupée (${quand})`
              : `${autre.intervenant} donne déjà un cours (${quand})`,
        );
      }
      const hors = horsHoraires(
        { jourSemaine: moi.jourSemaine, heureDebut: moi.heureDebut, dureeMinutes: moi.dureeMinutes },
        (await horairesParSite(tx))[moi.siteId] ?? [],
      );
      if (hors) alertes.push(hors);
    }
    const quand = `${dateCourte(creneau.date, true)} ${creneau.heureDebut}–${fin(creneau.heureDebut, creneau.dureeMinutes)}`;
    return {
      statut: "ok",
      texte:
        portee === "seance"
          ? `Séance déplacée au ${quand}.`
          : `Cours déplacé à partir du ${quand} : les séances suivantes suivent.`,
      alertes,
    };
  });
  revalidatePath("/planning");
  return r;
}
