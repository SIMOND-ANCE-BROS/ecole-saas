/**
 * Attend la fin de la frappe et ignore les réponses périmées. La fonction
 * renvoyée annule le minuteur et la publication, pas la requête réseau lancée.
 */
export function requeteDifferee<T>(
  charger: () => Promise<T>,
  publier: (resultat: T) => void,
  signalerErreur: () => void,
): () => void {
  let active = true;
  const minuteur = setTimeout(() => {
    charger().then(
      (resultat) => {
        if (active) publier(resultat);
      },
      () => {
        if (active) signalerErreur();
      },
    );
  }, 150);
  return () => {
    active = false;
    clearTimeout(minuteur);
  };
}
