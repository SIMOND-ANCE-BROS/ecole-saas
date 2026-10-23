import { withSchool } from "../db";
import { type OpenedLink, resetLink, readRelationship, SHARED, consumeLink } from "../db/equipe";
import { passwordRefusal } from "../domaine/equipe/regles";
import { auth } from "./auth";
import { createAccount } from "./comptes";

/**
 * Acceptation d'un lien d'invitation ou de réinitialisation (#104), ouvert
 * sans être connecté : le jeton (dans l'adresse) en est la seule preuve. Le
 * compte (global, Better Auth) est créé ou mis à jour, puis l'appartenance à
 * l'école est enregistrée sous RLS.
 */

export type LinkInput = { name: string; password: string; confirmation: string; currentPassword: string };
export type LinkResult = { ok: true; type: OpenedLink["type"]; email: string } | { ok: false; message: string };

const EXPIRE =
  "Ce lien n’est plus valable (déjà utilisé, révoqué ou expiré). Demandez-en un nouveau à la direction de l’école.";

/** Le lien, et si un compte existe déjà pour son e-mail (qui doit alors confirmer son mot de passe actuel). */
export async function openLink(
  schoolId: string,
  token: string,
): Promise<(OpenedLink & { existingAccount: boolean }) | null> {
  const link = await withSchool(schoolId, (tx) => readRelationship(tx, token, new Date()));
  if (!link) return null;
  const ctx = await auth.$context;
  const existingAccount = link.type === "invitation" ? !!(await ctx.internalAdapter.findUserByEmail(link.email)) : true;
  return { ...link, existingAccount };
}

export async function acceptLink(schoolId: string, token: string, saisie: LinkInput): Promise<LinkResult> {
  const link = await withSchool(schoolId, (tx) => readRelationship(tx, token, new Date()));
  if (!link) return { ok: false, message: EXPIRE };
  const ctx = await auth.$context;
  let userId: string;

  if (link.type === "reinitialisation") {
    const refusal = passwordRefusal(saisie.password, saisie.confirmation);
    if (refusal) return { ok: false, message: refusal };
    if (!link.userId) return { ok: false, message: EXPIRE };
    userId = link.userId;
  } else {
    const existing = await ctx.internalAdapter.findUserByEmail(link.email);
    if (existing) {
      // Déjà un compte (dans une autre école) : il prouve qu'il en est le titulaire.
      const credential = await ctx.internalAdapter.findCredentialAccount(existing.user.id);
      const bon = credential?.password
        ? await ctx.password.verify({ password: saisie.currentPassword, hash: credential.password })
        : false;
      if (!bon) return { ok: false, message: "Mot de passe actuel incorrect." };
      userId = existing.user.id;
    } else {
      const refusal = passwordRefusal(saisie.password, saisie.confirmation);
      if (refusal) return { ok: false, message: refusal };
      const name = saisie.name.trim() || link.name || link.email;
      if (name.length > 100) return { ok: false, message: "Nom trop long." };
      // Relu juste avant la création : un lien utilisé entre-temps ne crée pas de compte orphelin.
      if (!(await withSchool(schoolId, (tx) => readRelationship(tx, token, new Date()))))
        return { ok: false, message: EXPIRE };
      userId = await createAccount({ email: link.email, name, password: saisie.password, emailVerified: false });
    }
  }

  // Vérification et marquage dans la même transaction, juste avant de changer le mot de passe.
  const used = await withSchool(schoolId, (tx) => consumeLink(tx, link, userId));
  if (used === "partage") return { ok: false, message: SHARED };
  if (used !== "ok") return { ok: false, message: EXPIRE };
  if (link.type === "reinitialisation") {
    await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(saisie.password));
    // Les sessions ouvertes avec l'ancien mot de passe sont fermées.
    await ctx.internalAdapter.deleteUserSessions(userId);
  }
  return { ok: true, type: link.type, email: link.email };
}

/** Lien de réinitialisation pour un membre (direction) ; refusé pour un compte qui sert aussi dans une autre école. */
export function createResetLink(schoolId: string, userId: string, memberId: string) {
  return withSchool(schoolId, (tx) => resetLink(tx, userId, memberId, new Date()));
}
