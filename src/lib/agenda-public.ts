import type { Fournisseur } from "../connecteurs/agenda/oauth";

/**
 * Adresses publiques de l'agenda d'un intervenant. La redirection OAuth doit
 * être identique à celle déclarée chez Google et Microsoft : elle part de
 * BETTER_AUTH_URL (adresse publique de l'application), pas de la requête.
 */
export const adressePublique = () => (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const redirectionOAuth = (f: Fournisseur) => `${adressePublique()}/api/agenda/retour/${f}`;
export const pagePersonnelle = (ecoleId: string, jeton: string) => `/mon-agenda/${ecoleId}/${jeton}`;
export const COOKIE_OAUTH = "agenda_oauth";
