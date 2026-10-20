/**
 * Toute autre adresse ferme le panneau. Sans cela, un slot parallèle garde son
 * contenu lors d'une navigation côté client (redirection après enregistrement,
 * lien vers une autre page).
 */
export default function SansPanneau() {
  return null;
}
