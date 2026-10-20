import { appliquerTaux, formaterEuros } from "../../lib/montant";
import type {
  CoursChoisi,
  DemandeInscription,
  DemandeTarif,
  DetailReduction,
  LigneTarif,
  Periodicite,
  Public,
  RegleReduction,
  ResultatInscription,
  ResultatTarif,
} from "./types";

/**
 * Calcule le prix des inscriptions d'un payeur pour une saison, avec le détail
 * à afficher à l'accueil : forfait retenu, réductions appliquées ou écartées.
 *
 * - Le forfait est la ligne de la grille dont la combinaison de durées est
 *   exactement celle des cours choisis ; une ligne réservée à une discipline
 *   prime quand tous les cours sont de cette discipline. Combinaison absente :
 *   erreur, l'accueil saisit le prix.
 * - Chaque réduction est arrondie au centime sur sa propre inscription ; les
 *   totaux sont la somme des lignes.
 */
export function calculerTarif(demande: DemandeTarif): ResultatTarif {
  demande.reductions.forEach(verifierRegle);

  const inscriptions = demande.inscriptions.map((inscription) =>
    tarifer(inscription, demande),
  );
  const tarifees = inscriptions.filter((r) => r.statut === "ok");
  const somme = (cle: "prixBrutCentimes" | "remiseCentimes" | "prixNetCentimes") =>
    tarifees.reduce((total, r) => total + r[cle], 0);

  return {
    inscriptions,
    totalBrutCentimes: somme("prixBrutCentimes"),
    totalRemiseCentimes: somme("remiseCentimes"),
    totalNetCentimes: somme("prixNetCentimes"),
    complet: tarifees.length === inscriptions.length,
  };
}

function tarifer(inscription: DemandeInscription, demande: DemandeTarif): ResultatInscription {
  const { reference, cours } = inscription;
  if (cours.length === 0) {
    return {
      reference,
      statut: "erreur",
      erreur: { code: "aucun_cours", message: "Aucun cours choisi : impossible de déterminer le forfait." },
    };
  }

  const combinaison = trier(cours.map((c) => c.dureeMinutes));
  const ligne = trouverLigne(demande.grille, inscription, combinaison);
  if (!ligne) {
    return {
      reference,
      statut: "erreur",
      erreur: {
        code: "combinaison_absente",
        message:
          `Aucun forfait « ${LIBELLE_PUBLIC[inscription.public]} » ${LIBELLE_PERIODICITE[inscription.periodicite]} ` +
          `pour ${libelleCombinaison(combinaison)} : prix à saisir par l’accueil.`,
      },
    };
  }

  const prixBrutCentimes = ligne.prixCentimes;
  let restant = prixBrutCentimes;
  const reductions = demande.reductions.map((regle): DetailReduction => {
    const decision = evaluer(regle, inscription, demande.inscriptions);
    if (decision.statut === "ecartee") {
      return { code: regle.code, statut: "ecartee", montantCentimes: 0, motif: decision.motif };
    }
    const montant = Math.min(montantReduction(regle, prixBrutCentimes), restant);
    restant -= montant;
    return { code: regle.code, statut: "appliquee", montantCentimes: montant, motif: decision.motif };
  });
  const remiseCentimes = prixBrutCentimes - restant;

  return {
    reference,
    statut: "ok",
    ligneTarifId: ligne.id,
    libelleForfait: libelleCombinaison(combinaison),
    prixBrutCentimes,
    reductions,
    remiseCentimes,
    prixNetCentimes: prixBrutCentimes - remiseCentimes,
  };
}

function trouverLigne(
  grille: readonly LigneTarif[],
  inscription: DemandeInscription,
  combinaison: number[],
): LigneTarif | undefined {
  const candidates = grille.filter(
    (l) =>
      l.public === inscription.public &&
      l.periodicite === inscription.periodicite &&
      memesDurees(trier(l.combinaison), combinaison),
  );
  const discipline = disciplineUnique(inscription.cours);
  return (
    (discipline !== null && candidates.find((l) => l.disciplineId === discipline)) ||
    candidates.find((l) => l.disciplineId === null)
  );
}

type Decision = { statut: "appliquee" | "ecartee"; motif: string };

function evaluer(
  regle: RegleReduction,
  inscription: DemandeInscription,
  toutes: readonly DemandeInscription[],
): Decision {
  if (regle.code !== "fratrie") {
    return { statut: "ecartee", motif: "Type de réduction non pris en charge par le moteur de tarif" };
  }

  const eligible = (p: Public) => regle.publics.length === 0 || regle.publics.includes(p);
  if (!eligible(inscription.public)) {
    const publics = regle.publics.map((p) => LIBELLE_PUBLIC[p]).join(", ");
    return {
      statut: "ecartee",
      motif: regle.publics.length === 1 ? `Réservée au public ${publics}` : `Réservée aux publics ${publics}`,
    };
  }

  // Danseurs distincts du payeur dans un public éligible, y compris ceux dont
  // le forfait est à saisir à la main ou sur un forfait 2 disciplines.
  const danseurs = new Set(toutes.filter((i) => eligible(i.public)).flatMap((i) => i.danseurIds));
  const compte = `${danseurs.size} ${nommer(regle, danseurs.size)} du même payeur`;
  if (danseurs.size < regle.seuilDanseurs) {
    return { statut: "ecartee", motif: `${compte}, ${regle.seuilDanseurs} requis` };
  }

  if (!regle.cumulableMultiDisciplines && new Set(inscription.cours.map((c) => c.disciplineId)).size >= 2) {
    return { statut: "ecartee", motif: "Non cumulable avec un forfait 2 disciplines" };
  }

  return { statut: "appliquee", motif: `${compte} : -${valeur(regle)}` };
}

function montantReduction(regle: RegleReduction, prixCentimes: number): number {
  return regle.tauxPointsBase !== null
    ? appliquerTaux(prixCentimes, regle.tauxPointsBase)
    : (regle.montantCentimes as number);
}

/** Une réduction mal paramétrée est une erreur de données, pas un cas à afficher. */
function verifierRegle(regle: RegleReduction) {
  if ((regle.tauxPointsBase === null) === (regle.montantCentimes === null)) {
    throw new TypeError(`Réduction « ${regle.code} » : renseigner un taux ou un montant, pas les deux`);
  }
}

// ---------------------------------------------------------------------------
// Libellés
// ---------------------------------------------------------------------------

const LIBELLE_PUBLIC: Record<Public, string> = {
  enfant: "enfant",
  adulte: "adulte",
  couple: "couple",
  etudiant: "étudiant",
};

const LIBELLE_PERIODICITE: Record<Periodicite, string> = {
  trimestre: "au trimestre",
  annee: "à l’année",
  unite: "à l’unité",
};

/** « enfant(s) » si la règle ne vise que les enfants, « danseur(s) » sinon. */
function nommer(regle: RegleReduction, nombre: number): string {
  const nom = regle.publics.length === 1 && regle.publics[0] === "enfant" ? "enfant" : "danseur";
  return nombre > 1 ? `${nom}s` : nom;
}

function valeur(regle: RegleReduction): string {
  return regle.tauxPointsBase !== null
    ? `${(regle.tauxPointsBase / 100).toLocaleString("fr-FR")} %`
    : formaterEuros(regle.montantCentimes as number);
}

/** [45, 60] → « 45 min + 1 h 00 » */
export function libelleCombinaison(combinaison: readonly number[]): string {
  return combinaison
    .map((m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`))
    .join(" + ");
}

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

function trier(durees: readonly number[]): number[] {
  for (const d of durees) {
    if (!Number.isInteger(d) || d <= 0) throw new TypeError(`Durée de cours invalide : ${d}`);
  }
  return [...durees].sort((a, b) => a - b);
}

function memesDurees(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i]);
}

/** La discipline commune à tous les cours, ou null s'ils en mélangent plusieurs. */
function disciplineUnique(cours: readonly CoursChoisi[]): string | null {
  const disciplines = new Set(cours.map((c) => c.disciplineId));
  return disciplines.size === 1 ? [...disciplines][0] : null;
}
