import { type EmailSender, emailSender } from "../connectors/email/sender";
import { withSchool } from "../db";
import {
  type OpenedLink,
  resetLink,
  readRelationship,
  SHARED,
  consumeLink,
  newEmailCode,
  dropEmailCode,
  emailCodeValid,
} from "../db/team";
import { type JoinProof, emailProofMessage, joinProof } from "../domain/team/email-proof";
import { passwordRefusal } from "../domain/team/rules";
import { auth } from "./auth";
import { createAccount } from "./accounts";
import { publicAddress } from "./public-calendar";

/**
 * Accepting an invitation or reset link (#104), opened without being signed
 * in: the token (in the URL) is the only proof. The account (global, Better
 * Auth) is created or updated, then the school membership is recorded under
 * RLS.
 */

export type LinkInput = { name: string; password: string; confirmation: string; currentPassword: string };
export type LinkResult = { ok: true; type: OpenedLink["type"]; email: string } | { ok: false; message: string };

const EXPIRED =
  "Ce lien n’est plus valable (déjà utilisé, révoqué ou expiré). Demandez-en un nouveau à la direction de l’école.";

const EMAIL_FIRST =
  "Confirmez d’abord votre adresse e-mail : demandez le lien ci-dessous, il vous permettra de rejoindre l’école.";

/** Whether this server can send e-mail (no provider until #105). */
const canSendEmail = (sender: EmailSender | null) => sender !== null;

/**
 * The link, whether an account already exists for its e-mail, and how an
 * invitation is proven (#179, `joinProof`): creating the access, the current
 * password, or a link e-mailed to an unverified account's address.
 */
export async function openLink(
  schoolId: string,
  token: string,
  sender: EmailSender | null = emailSender(),
): Promise<(OpenedLink & { existingAccount: boolean; proof: JoinProof | null }) | null> {
  const link = await withSchool(schoolId, (tx) => readRelationship(tx, token, new Date()));
  if (!link) return null;
  if (link.type === "reset") return { ...link, existingAccount: true, proof: null };
  const ctx = await auth.$context;
  const existing = await ctx.internalAdapter.findUserByEmail(link.email);
  const proof = joinProof(existing && { emailVerified: existing.user.emailVerified }, canSendEmail(sender));
  return { ...link, existingAccount: !!existing, proof };
}

export type SendProofResult = { ok: true } | { ok: false; message: string };

/**
 * E-mails the invited address a link proving it is theirs (#179), for an
 * invitation of an unverified account. Never logs the address nor the code.
 */
export async function sendEmailProof(
  schoolId: string,
  token: string,
  sender: EmailSender | null = emailSender(),
  now = new Date(),
): Promise<SendProofResult> {
  const link = await openLink(schoolId, token, sender);
  if (!link) return { ok: false, message: EXPIRED };
  if (!sender || link.proof !== "email")
    return { ok: false, message: "Ce lien ne demande pas de confirmation par e-mail." };
  const code = await withSchool(schoolId, (tx) => newEmailCode(tx, link, now));
  if (!code) return { ok: false, message: EXPIRED };
  if (!code.ok)
    return {
      ok: false,
      message: `Un e-mail vient déjà de partir : vérifiez votre boîte de réception (et les indésirables), ou réessayez dans ${code.wait} s.`,
    };
  const url = `${linkAddress(schoolId, token)}/verification/${code.code}`;
  const sent = await sender.send({ to: link.email, ...emailProofMessage({ school: link.school, url }) });
  if (!sent.ok) {
    await withSchool(schoolId, (tx) => dropEmailCode(tx, link, code.code));
    return { ok: false, message: "L’e-mail n’a pas pu partir. Réessayez dans quelques minutes." };
  }
  return { ok: true };
}

/** The invitation, if `code` is its last e-mailed code and still valid (#179). */
export async function openEmailProof(schoolId: string, token: string, code: string): Promise<OpenedLink | null> {
  return withSchool(schoolId, async (tx) => {
    const now = new Date();
    const link = await readRelationship(tx, token, now);
    return link && (await emailCodeValid(tx, link, code, now)) ? link : null;
  });
}

export type ProofInput = { password: string; confirmation: string };

/**
 * The owner of the invited e-mail, proven by the e-mailed code (#179), joins
 * the school with their account: they choose its password, the e-mail is
 * marked verified and every open session closes (whoever created the account
 * with this e-mail loses it).
 */
export async function acceptEmailProof(
  schoolId: string,
  token: string,
  code: string,
  entry: ProofInput,
): Promise<LinkResult> {
  const link = await openEmailProof(schoolId, token, code);
  if (!link) return { ok: false, message: EXPIRED };
  const refusal = passwordRefusal(entry.password, entry.confirmation);
  if (refusal) return { ok: false, message: refusal };
  const ctx = await auth.$context;
  const existing = await ctx.internalAdapter.findUserByEmail(link.email);
  if (!existing) return { ok: false, message: EXPIRED };
  const userId = existing.user.id;
  // Check and mark in the same transaction, code included, just before changing the password.
  const used = await withSchool(schoolId, (tx) => consumeLink(tx, link, userId, { code, now: new Date() }));
  if (used !== "ok") return { ok: false, message: EXPIRED };
  const passwordHash = await ctx.password.hash(entry.password);
  if (await ctx.internalAdapter.findCredentialAccount(userId))
    await ctx.internalAdapter.updatePassword(userId, passwordHash);
  else
    await ctx.internalAdapter.linkAccount({
      userId,
      providerId: "credential",
      accountId: userId,
      password: passwordHash,
    });
  await ctx.internalAdapter.updateUser(userId, { emailVerified: true });
  // Sessions opened with the old password (by whoever chose it) are closed.
  await ctx.internalAdapter.deleteUserSessions(userId);
  return { ok: true, type: "invitation", email: link.email };
}

export async function acceptLink(
  schoolId: string,
  token: string,
  entry: LinkInput,
  sender: EmailSender | null = emailSender(),
): Promise<LinkResult> {
  const link = await withSchool(schoolId, (tx) => readRelationship(tx, token, new Date()));
  if (!link) return { ok: false, message: EXPIRED };
  const ctx = await auth.$context;
  let userId: string;

  if (link.type === "reset") {
    const refusal = passwordRefusal(entry.password, entry.confirmation);
    if (refusal) return { ok: false, message: refusal };
    if (!link.userId) return { ok: false, message: EXPIRED };
    userId = link.userId;
  } else {
    const existing = await ctx.internalAdapter.findUserByEmail(link.email);
    if (existing) {
      // An unverified account proves its e-mail first, once e-mail can be sent (#179).
      if (joinProof({ emailVerified: existing.user.emailVerified }, canSendEmail(sender)) === "email")
        return { ok: false, message: EMAIL_FIRST };
      // Already an account (in another school): the user proves they own it.
      const credential = await ctx.internalAdapter.findCredentialAccount(existing.user.id);
      const verified = credential?.password
        ? await ctx.password.verify({ password: entry.currentPassword, hash: credential.password })
        : false;
      if (!verified) return { ok: false, message: "Mot de passe actuel incorrect." };
      userId = existing.user.id;
    } else {
      const refusal = passwordRefusal(entry.password, entry.confirmation);
      if (refusal) return { ok: false, message: refusal };
      const name = entry.name.trim() || link.name || link.email;
      if (name.length > 100) return { ok: false, message: "Nom trop long." };
      // Re-read just before creation: a link used in the meantime does not create an orphan account.
      if (!(await withSchool(schoolId, (tx) => readRelationship(tx, token, new Date()))))
        return { ok: false, message: EXPIRED };
      userId = await createAccount({ email: link.email, name, password: entry.password, emailVerified: false });
    }
  }

  // Check and mark in the same transaction, just before changing the password.
  const used = await withSchool(schoolId, (tx) => consumeLink(tx, link, userId));
  if (used === "shared") return { ok: false, message: SHARED };
  if (used !== "ok") return { ok: false, message: EXPIRED };
  if (link.type === "reset") {
    await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(entry.password));
    // Sessions opened with the old password are closed.
    await ctx.internalAdapter.deleteUserSessions(userId);
  }
  return { ok: true, type: link.type, email: link.email };
}

/** Address of an invitation or reset link, to copy and pass on (SMS, personal e-mail…). */
export const linkAddress = (schoolId: string, token: string) => `${publicAddress()}/invitation/${schoolId}/${token}`;

/** Reset link for a member (management); refused for an account also used in another school. */
export function createResetLink(schoolId: string, userId: string, memberId: string) {
  return withSchool(schoolId, (tx) => resetLink(tx, userId, memberId, new Date()));
}
