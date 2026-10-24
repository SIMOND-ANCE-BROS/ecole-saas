import { withSchool } from "../db";
import { type OpenedLink, resetLink, readRelationship, SHARED, consumeLink } from "../db/team";
import { passwordRefusal } from "../domain/team/rules";
import { auth } from "./auth";
import { createAccount } from "./accounts";

/**
 * Accepting an invitation or reset link (#104), opened without being signed
 * in: the token (in the URL) is the only proof. The account (global, Better
 * Auth) is created or updated, then the school membership is recorded under
 * RLS.
 */

export type LinkInput = { name: string; password: string; confirmation: string; currentPassword: string };
export type LinkResult = { ok: true; type: OpenedLink["type"]; email: string } | { ok: false; message: string };

const EXPIRE =
  "Ce lien n’est plus valable (déjà utilisé, révoqué ou expiré). Demandez-en un nouveau à la direction de l’école.";

/** The link, and whether an account already exists for its e-mail (which must then confirm its current password). */
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

export async function acceptLink(schoolId: string, token: string, entry: LinkInput): Promise<LinkResult> {
  const link = await withSchool(schoolId, (tx) => readRelationship(tx, token, new Date()));
  if (!link) return { ok: false, message: EXPIRE };
  const ctx = await auth.$context;
  let userId: string;

  if (link.type === "reset") {
    const refusal = passwordRefusal(entry.password, entry.confirmation);
    if (refusal) return { ok: false, message: refusal };
    if (!link.userId) return { ok: false, message: EXPIRE };
    userId = link.userId;
  } else {
    const existing = await ctx.internalAdapter.findUserByEmail(link.email);
    if (existing) {
      // Already an account (in another school): the user proves they own it.
      const credential = await ctx.internalAdapter.findCredentialAccount(existing.user.id);
      const bon = credential?.password
        ? await ctx.password.verify({ password: entry.currentPassword, hash: credential.password })
        : false;
      if (!bon) return { ok: false, message: "Mot de passe actuel incorrect." };
      userId = existing.user.id;
    } else {
      const refusal = passwordRefusal(entry.password, entry.confirmation);
      if (refusal) return { ok: false, message: refusal };
      const name = entry.name.trim() || link.name || link.email;
      if (name.length > 100) return { ok: false, message: "Nom trop long." };
      // Re-read just before creation: a link used in the meantime does not create an orphan account.
      if (!(await withSchool(schoolId, (tx) => readRelationship(tx, token, new Date()))))
        return { ok: false, message: EXPIRE };
      userId = await createAccount({ email: link.email, name, password: entry.password, emailVerified: false });
    }
  }

  // Check and mark in the same transaction, just before changing the password.
  const used = await withSchool(schoolId, (tx) => consumeLink(tx, link, userId));
  if (used === "partage") return { ok: false, message: SHARED };
  if (used !== "ok") return { ok: false, message: EXPIRE };
  if (link.type === "reset") {
    await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(entry.password));
    // Sessions opened with the old password are closed.
    await ctx.internalAdapter.deleteUserSessions(userId);
  }
  return { ok: true, type: link.type, email: link.email };
}

/** Reset link for a member (management); refused for an account also used in another school. */
export function createResetLink(schoolId: string, userId: string, memberId: string) {
  return withSchool(schoolId, (tx) => resetLink(tx, userId, memberId, new Date()));
}
