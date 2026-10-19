import type { DemandeCarnet, LigneTarifCarnet, ResultatCarnet } from "./types";

/**
 * Prix d'un carnet de cours particuliers d'après la grille de l'école.
 * Une ligne vaut pour « jusqu'à N personnes » : on retient la plus petite
 * tranche qui couvre le nombre de personnes. Hors grille (nombre de séances
 * inconnu, groupe trop grand) : erreur, prix sur devis saisi par l'accueil.
 */
export function tarifierCarnet(grille: readonly LigneTarifCarnet[], demande: DemandeCarnet): ResultatCarnet {
  const { nbSeances, nbPersonnes } = demande;
  for (const [nom, valeur] of Object.entries(demande)) {
    if (!Number.isInteger(valeur) || valeur < 1) throw new TypeError(`${nom} invalide : ${valeur}`);
  }

  const tranches = grille
    .filter((l) => l.nbSeances === nbSeances)
    .sort((a, b) => a.personnesMax - b.personnesMax);
  const index = tranches.findIndex((l) => l.personnesMax >= nbPersonnes);
  if (index === -1) {
    return {
      statut: "erreur",
      erreur: {
        code: "hors_grille",
        message: `Aucun tarif pour ${nbSeances} cours à ${personnes(nbPersonnes)} : prix sur devis, à saisir par l’accueil.`,
      },
    };
  }

  const ligne = tranches[index];
  const minimum = index === 0 ? 1 : tranches[index - 1].personnesMax + 1;
  const tranche =
    minimum === ligne.personnesMax ? personnes(minimum) : `${minimum} à ${personnes(ligne.personnesMax)}`;
  return {
    statut: "ok",
    ligneTarifCarnetId: ligne.id,
    libelle: `${nbSeances} cours · ${tranche}`,
    prixCentimes: ligne.prixCentimes,
  };
}

function personnes(n: number): string {
  return n > 1 ? `${n} personnes` : `${n} personne`;
}
