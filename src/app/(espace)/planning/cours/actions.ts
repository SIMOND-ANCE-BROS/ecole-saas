"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { avecEcole } from "@/db";
import { creerCours, deplacerCours, lireCours, modifierCours, saisieCoursValide, supprimerCours } from "@/db/cours";
import { conflitsCreneau } from "@/db/disponibilites";
import { horairesParSite } from "@/db/parametres";
import { coursDeLaSaison, saisonCourante } from "@/db/planning";
import { synchroniserSeances } from "@/db/seances";
import { conflits } from "@/domaine/planning/chevauchement";
import { horsHoraires } from "@/domaine/planning/horaires";
import { JOURS_COURTS } from "@/domaine/planning/jours";
import { aujourdhuiAParis } from "@/domaine/personnes/age";
import { exigerRole } from "@/lib/session";

export type Refus = { message: string; erreurs: Partial<Record<string, string>> };

/** Crée (id null) ou modifie un cours de la saison courante ; réservé à la direction. */
export async function enregistrerCours(id: string | null, saisie: unknown): Promise<Refus> {
  const { ecoleId } = await exigerRole("direction");
  const donnees = saisieCoursValide.safeParse(saisie);
  if (!donnees.success) {
    const erreurs: Refus["erreurs"] = {};
    for (const p of donnees.error.issues) erreurs[String(p.path[0])] ??= p.message;
    return { message: "Vérifiez les champs signalés.", erreurs };
  }
  const aujourdhui = aujourdhuiAParis();
  const resultat = await avecEcole(ecoleId, async (tx) => {
    const saisonId = id !== null ? (await lireCours(tx, id))?.saisonId : (await saisonCourante(tx, aujourdhui))?.id;
    if (!saisonId)
      return {
        ok: false as const,
        message: id !== null ? "Ce cours n’existe plus." : "Aucune saison n’est paramétrée.",
      };
    const r = id !== null ? await modifierCours(tx, id, donnees.data) : await creerCours(tx, saisonId, donnees.data);
    // Séances à venir recalculées dans la même transaction (jour changé, nouveau cours…).
    if (r.ok) await synchroniserSeances(tx, saisonId, aujourdhui);
    return r;
  });
  if (!resultat.ok) return { message: resultat.message, erreurs: {} };
  redirect(id === null ? `/planning?enregistre=${resultat.id}` : `/planning/cours/${resultat.id}?modifie=1`);
}

export async function supprimer(id: string): Promise<Refus> {
  const { ecoleId } = await exigerRole("direction");
  const resultat = await avecEcole(ecoleId, (tx) => supprimerCours(tx, id));
  if (!resultat.ok) return { message: resultat.message, erreurs: {} };
  redirect("/planning?supprime=1");
}

/** Dates à venir où l'intervenant choisi serait indisponible sur ce créneau (pendant la saisie). */
export async function verifierCreneau(
  coursId: string | null,
  creneau: { intervenantId: string; jourSemaine: number; heureDebut: string; dureeMinutes: number },
): Promise<string[]> {
  const { ecoleId } = await exigerRole("direction");
  const aujourdhui = aujourdhuiAParis();
  return avecEcole(ecoleId, async (tx) => {
    const saisonId = coursId ? (await lireCours(tx, coursId))?.saisonId : (await saisonCourante(tx, aujourdhui))?.id;
    return saisonId ? conflitsCreneau(tx, { ...creneau, saisonId }, aujourdhui) : [];
  });
}

export type RetourDeplacement =
  | { statut: "ok"; alertes: string[] }
  | { statut: "confirmer"; inscrits: number }
  | { statut: "refus"; message: string };

const dateCourte = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Glisser-déposer de la vue agenda : nouveau jour, heure ou durée. Les séances
 * à venir suivent ; le résultat signale salle ou intervenant déjà pris et les
 * indisponibilités de l'intervenant sur ce créneau.
 */
export async function deplacer(coursId: string, creneau: unknown, confirme: boolean): Promise<RetourDeplacement> {
  const { ecoleId } = await exigerRole("direction");
  const aujourdhui = aujourdhuiAParis();
  const r = await avecEcole(ecoleId, async (tx) => {
    const d = await deplacerCours(tx, coursId, creneau as Parameters<typeof deplacerCours>[2], confirme);
    if (d.statut !== "ok") return d;
    const c = await lireCours(tx, coursId);
    if (!c) return { statut: "refus" as const, message: "Ce cours n’existe plus." };
    await synchroniserSeances(tx, c.saisonId, aujourdhui);
    const planning = await coursDeLaSaison(tx, c.saisonId);
    const moi = planning.find((p) => p.id === coursId);
    const alertes = moi
      ? conflits(moi, planning).map((x) => {
          const autre = planning.find((p) => p.id === x.id)!;
          const quand = `${autre.discipline}, ${JOURS_COURTS[autre.jourSemaine ?? 0]} ${autre.heureDebut}`;
          if (x.salle && x.intervenant) return `${autre.salle} et ${autre.intervenant} déjà pris (${quand})`;
          return x.salle
            ? `${autre.salle} déjà occupée (${quand})`
            : `${autre.intervenant} donne déjà un cours (${quand})`;
        })
      : [];
    if (moi && c.jourSemaine) {
      const hors = horsHoraires(
        { jourSemaine: c.jourSemaine, heureDebut: c.heureDebut, dureeMinutes: c.dureeMinutes },
        (await horairesParSite(tx))[moi.siteId] ?? [],
      );
      if (hors) alertes.push(hors);
    }
    if (c.jourSemaine) {
      const dates = await conflitsCreneau(
        tx,
        {
          saisonId: c.saisonId,
          intervenantId: c.intervenantId,
          jourSemaine: c.jourSemaine,
          heureDebut: c.heureDebut,
          dureeMinutes: c.dureeMinutes,
        },
        aujourdhui,
      );
      if (dates.length > 0) {
        alertes.push(
          `Intervenant indisponible le ${dates
            .slice(0, 4)
            .map((x) => dateCourte.format(new Date(`${x}T00:00:00Z`)))
            .join(", ")}${dates.length > 4 ? "…" : ""}`,
        );
      }
    }
    return { statut: "ok" as const, alertes };
  });
  revalidatePath("/planning");
  return r;
}
