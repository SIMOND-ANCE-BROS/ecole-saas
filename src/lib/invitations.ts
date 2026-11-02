import { type EmailSender, emailSender } from "../connectors/email/sender";
import { schoolsOf, withSchool } from "../db";
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
import { type JoinProof, emailProofMessage, joinProof, retryIn } from "../domain/team/email-proof";
import { type Role, passwordRefusal } from "../domain/team/rules";
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

/** A school the account belongs to, as shown to its owner after a take-back (#404). */
export type AccountSchool = { name: string; role: Role };
export type ProofResult = { ok: true; email: string; schools: AccountSchool[] } | { ok: false; message: string };

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

/** `tooSoon`: an e-mail went recently, the person only has to wait (not an error). */
export type SendProofResult = { ok: true } | { ok: false; message: string; tooSoon?: true };

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
      tooSoon: true,
      message: `Un e-mail est déjà parti récemment : vérifiez votre boîte de réception et les indésirables, ou réessayez ${retryIn(code.wait)}.`,
    };
  const url = `${linkAddress(schoolId, token)}/verification/${code.code}`;
  // A provider must not throw; if one does, its code is withdrawn all the same.
  const sent = await sender
    .send({ to: link.email, ...emailProofMessage({ school: link.school, url }) })
    .catch(() => ({ ok: false }) as const);
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
 * with this e-mail loses it). Returns the account's schools (#404): it keeps
 * the memberships it had, including any that whoever chose the old password
 * joined, and the owner should be able to spot one they never joined.
 */
export async function acceptEmailProof(
  schoolId: string,
  token: string,
  code: string,
  entry: ProofInput,
): Promise<ProofResult> {
  const link = await openEmailProof(schoolId, token, code);
  if (!link) return { ok: false, message: EXPIRED };
  const refusal = passwordRefusal(entry.password, entry.confirmation);
  if (refusal) return { ok: false, message: refusal };
  const ctx = await auth.$context;
  const existing = await ctx.internalAdapter.findUserByEmail(link.email);
  if (!existing) return { ok: false, message: EXPIRED };
  const userId = existing.user.id;
  const passwordHash = await ctx.password.hash(entry.password);
  // One transaction: the code checked again, the link used, the school joined, and the account's
  // new password, verified e-mail and closed sessions. Whoever chose the old password never
  // reaches the school with it, even for an instant or if a step fails.
  const used = await withSchool(schoolId, (tx) =>
    consumeLink(tx, link, userId, { code, now: new Date() }, { passwordHash, verifiedEmail: true }),
  );
  if (used !== "ok") return { ok: false, message: EXPIRED };
  const schools = (await schoolsOf(userId)).map((m) => ({ name: m.name, role: m.role }));
  return { ok: true, email: link.email, schools };
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

  // A reset changes the password and closes the sessions in the same transaction as the check
  // that the account is in no other school (#179: serialised with an e-mail proof).
  const credentials =
    link.type === "reset" ? { passwordHash: await ctx.password.hash(entry.password), verifiedEmail: false } : undefined;
  const used = await withSchool(schoolId, (tx) => consumeLink(tx, link, userId, undefined, credentials));
  if (used === "shared") return { ok: false, message: SHARED };
  if (used !== "ok") return { ok: false, message: EXPIRED };
  return { ok: true, type: link.type, email: link.email };
}

/** Address of an invitation or reset link, to copy and pass on (SMS, personal e-mail…). */
export const linkAddress = (schoolId: string, token: string) => `${publicAddress()}/invitation/${schoolId}/${token}`;

/** Reset link for a member (management); refused for an account also used in another school. */
export function createResetLink(schoolId: string, userId: string, memberId: string) {
  return withSchool(schoolId, (tx) => resetLink(tx, userId, memberId, new Date()));
}
