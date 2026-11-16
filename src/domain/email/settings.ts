/**
 * A school's e-mail sending setting (#105, ADR 0009): which provider sends its
 * invitations and password links, from which address. Pure: no database, no
 * network.
 */

export const EMAIL_PROVIDER_VALUES = ["brevo", "resend"] as const;
export type EmailProvider = (typeof EMAIL_PROVIDER_VALUES)[number];

export const EMAIL_PROVIDER_LABELS: Record<EmailProvider, string> = { brevo: "Brevo", resend: "Resend" };

/** What each provider means for the school, said on the settings screen. */
export const EMAIL_PROVIDER_DETAILS: Record<EmailProvider, string> = {
  brevo: "Service français, dans l’Union européenne. Celui de l’application par défaut.",
  resend:
    "Service américain : les adresses et les messages sont transférés hors de l’Union européenne (clauses contractuelles types). À choisir en connaissance de cause.",
};

/** Most characters of a sender's display name and of an API key. */
export const FROM_NAME_MAX = 70;
export const API_KEY_MAX = 200;

/** Where the e-mails of a school go out from (screens and logs say it, never the key). */
export type EmailRoute =
  /** The school's own provider account. */
  | { kind: "school"; provider: EmailProvider }
  /** The application's sender (Brevo), on the school's behalf. */
  | { kind: "platform" }
  /** The fake sender: nothing leaves (tests and demonstration). */
  | { kind: "fake" }
  /** The school's own setting cannot be used (unreadable key): nothing is sent, the link is shown. */
  | { kind: "broken"; provider: EmailProvider }
  /** No sender at all: links are passed on by hand. */
  | { kind: "none" };

/** Why a send failed, as the provider layer reports it (no personal data). */
export type SendFailureInfo = { reason: "unavailable" | "refused" | "timeout"; status?: number };

/**
 * A failed send in French, for management: what to check. The provider's
 * own message is never shown (it may quote the address).
 */
export function sendFailureMessage(f: SendFailureInfo): string {
  if (f.reason === "timeout") return "Le service d’envoi n’a pas répondu à temps. Réessayez dans quelques minutes.";
  if (f.reason === "unavailable")
    return f.status === 429
      ? "Le service d’envoi limite le nombre d’e-mails : réessayez dans quelques minutes, ou vérifiez le quota du compte."
      : "Le service d’envoi est indisponible. Réessayez dans quelques minutes.";
  if (f.status === 401 || f.status === 403)
    return "La clé d’API est refusée : vérifiez qu’elle est complète, active et autorisée à envoyer des e-mails.";
  return "Le service d’envoi a refusé l’e-mail : vérifiez que l’adresse d’expédition est validée chez lui (domaine vérifié, SPF et DKIM) et que l’adresse du destinataire est correcte.";
}

/** The route in French, for the settings screen. */
export function routeLabel(route: EmailRoute): string {
  switch (route.kind) {
    case "school":
      return `Les e-mails partent par le compte ${EMAIL_PROVIDER_LABELS[route.provider]} de l’école.`;
    case "platform":
      return "Les e-mails partent par le service d’envoi de l’application, au nom de l’école.";
    case "fake":
      return "Mode simulation : aucun e-mail ne part réellement.";
    case "broken":
      return `Le compte ${EMAIL_PROVIDER_LABELS[route.provider]} de l’école ne peut pas être utilisé : enregistrez de nouveau sa clé d’API. En attendant, les liens s’affichent pour être transmis à la main.`;
    case "none":
      return "Aucun service d’envoi : les liens d’invitation et de mot de passe s’affichent pour être transmis à la main.";
  }
}
