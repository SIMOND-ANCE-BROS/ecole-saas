/**
 * The e-mails carrying an invitation or a password link (#105), in plain text
 * (read by any mail client). The link alone gives access: the e-mail says how
 * long it works and what to do if it was not expected.
 */

export type LinkKind = "invitation" | "reset";

/** How long a link works, as the e-mail and the team screen say it. */
export const LINK_VALIDITY_TEXT: Record<LinkKind, string> = { invitation: "7 jours", reset: "24 heures" };

export function linkMessage(p: { kind: LinkKind; school: string; name: string | null; url: string }): {
  subject: string;
  text: string;
} {
  const hello = p.name ? `Bonjour ${p.name},` : "Bonjour,";
  if (p.kind === "invitation")
    return {
      subject: `Invitation à rejoindre ${p.school}`,
      text: [
        hello,
        "",
        `${p.school} vous invite à rejoindre son équipe sur son logiciel de gestion. Pour accepter et choisir votre mot de passe, ouvrez ce lien (valable ${LINK_VALIDITY_TEXT.invitation}) :`,
        "",
        p.url,
        "",
        "Si vous n’attendiez pas cette invitation, ignorez ce message : sans ce lien, rien ne change.",
      ].join("\n"),
    };
  return {
    subject: `Nouveau mot de passe pour ${p.school}`,
    text: [
      hello,
      "",
      `La direction de ${p.school} vous envoie un lien pour choisir un nouveau mot de passe. Ouvrez-le (valable ${LINK_VALIDITY_TEXT.reset}) :`,
      "",
      p.url,
      "",
      "Si vous n’avez rien demandé, ignorez ce message et prévenez la direction de l’école : votre mot de passe actuel reste valable tant que ce lien n’est pas utilisé.",
    ].join("\n"),
  };
}
