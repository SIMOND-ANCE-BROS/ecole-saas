import type { Provider } from "../connectors/calendar/oauth";

/**
 * Public URLs of an instructor's calendar. The OAuth redirect must be
 * identical to the one declared at Google and Microsoft: it is built from
 * BETTER_AUTH_URL (the application's public URL), not from the request.
 */
export const publicAddress = () => (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const oauthRedirect = (f: Provider) => `${publicAddress()}/api/agenda/retour/${f}`;
export const personalPage = (schoolId: string, token: string) => `/mon-agenda/${schoolId}/${token}`;
export const COOKIE_OAUTH = "agenda_oauth";
