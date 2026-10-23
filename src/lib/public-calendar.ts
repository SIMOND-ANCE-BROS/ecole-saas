import type { Provider } from "../connectors/calendar/oauth";

/**
 * Adresses publiques de l'agenda d'un intervenant. La redirection OAuth doit
 * être identique à celle déclarée chez Google et Microsoft : elle part de
 * BETTER_AUTH_URL (adresse publique de l'application), pas de la requête.
 */
export const publicAddress = () => (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const redirectionOAuth = (f: Provider) => `${publicAddress()}/api/agenda/retour/${f}`;
export const personalPage = (schoolId: string, token: string) => `/mon-agenda/${schoolId}/${token}`;
export const COOKIE_OAUTH = "agenda_oauth";
