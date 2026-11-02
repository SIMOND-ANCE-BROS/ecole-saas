import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt, isNull, like, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { EMAIL_PROOF_DURATION_MS, EMAIL_PROOF_RESEND_MS, addressWait, resendWait } from "../domain/team/email-proof";
import { changeRefusal, INVITABLE_ROLES, ROLE_VALUES, type Role } from "../domain/team/rules";
import { rowsOf } from "./columns-of";
import { db, type Tx } from "./index";
import { school, invitation, auditLog, member, user, account, session, verification } from "./schema";

/**
 * Team of a school (#104): members, invitations and reset
 * links. A link's token is returned only once, when
 * created; only its hash is kept. Always within the
 * `withSchool()` transaction (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DAY = 86_400_000;
export const INVITATION_DURATION = 7 * DAY;
export const RESET_DURATION = DAY;

export type Result = { ok: true; id: string } | { ok: false; message: string };
export type RelationshipResult = { ok: true; id: string; token: string } | { ok: false; message: string };

/**
 * What the audit log keeps of a link (#178): never its token nor its hash.
 * The e-mail only for an invitation, where nothing else names the person;
 * a reset link names the account (`userId`). The log is immutable, so
 * personal data in it is kept to the minimum.
 */
const LOGGED_LINK = {
  id: invitation.id,
  type: invitation.type,
  email: invitation.email,
  role: invitation.role,
  userId: invitation.userId,
  createdBy: invitation.createdBy,
  expiresAt: invitation.expiresAt,
};
type LoggedLink = {
  id: string;
  type: "invitation" | "reset";
  email: string;
  role: Role | null;
  userId: string | null;
  createdBy: string | null;
  expiresAt: Date;
};

/** Records links created or deleted (revoked, replaced, or dropped with their author) by `actor`. */
async function logLinks(tx: Tx, actor: string, action: "insert" | "delete", links: LoggedLink[]) {
  if (links.length === 0) return;
  await tx.insert(auditLog).values(
    rowsOf(
      auditLog,
      links.map(({ id, email, ...l }) => {
        const entry = { ...l, ...(l.type === "invitation" ? { email } : {}), expiresAt: l.expiresAt.toISOString() };
        return {
          schoolId: CURRENT_SCHOOL,
          actor,
          targetTable: "invitation",
          rowId: id,
          action,
          before: action === "delete" ? entry : null,
          after: action === "insert" ? entry : null,
        };
      }),
    ),
  );
}

/** Active member of management: the only one who manages the team (checked here too, not only by the page). */
async function memberOf(tx: Tx, userId: string) {
  const [m] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true), eq(member.role, "director")));
  return m?.id ?? null;
}

/**
 * Does the account belong (even deactivated) to another school? Its
 * password gives access there: one school must not be able to change it for
 * another. Read in the current transaction thanks to the RLS policy
 * `my_memberships` (app.user_id), reset to empty right away.
 */
async function elsewhereAccount(tx: Tx, userId: string): Promise<boolean> {
  await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(member)
    .where(and(eq(member.userId, userId), sql`${member.schoolId} <> ${CURRENT_SCHOOL}`));
  await tx.execute(sql`select set_config('app.user_id', '', true)`);
  return n > 0;
}
/**
 * A link only works while its author is still an active director: one who
 * leaves management (deactivated, or another role) cannot keep a way in.
 * Checked when the link is opened and again when it is used.
 */
const AUTHOR_STILL_DIRECTOR = sql`${invitation.createdBy} IN (
  SELECT ${member.id} FROM ${member} WHERE ${member.active} AND ${member.role} = 'director'
)`;

export const SHARED =
  "Ce compte sert aussi dans une autre école : la personne doit changer elle-même son mot de passe.";

/** (Global) account of a member of the school, or null. */
export async function memberAccount(tx: Tx, memberId: string): Promise<string | null> {
  if (!isUuid(memberId)) return null;
  const [m] = await tx.select({ userId: member.userId }).from(member).where(eq(member.id, memberId));
  return m?.userId ?? null;
}

export type MemberListItem = { id: string; userId: string; name: string; email: string; role: Role; active: boolean };

/** Members of the school, active first, by name. */
export function listMembers(tx: Tx): Promise<MemberListItem[]> {
  return tx
    .select({
      id: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      active: member.active,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .orderBy(sql`${member.active} DESC`, asc(user.name));
}

export type PendingInvitation = { id: string; email: string; name: string | null; role: Role | null; expiresAt: Date };

/** Invitations neither used nor expired. */
export function pendingInvitations(tx: Tx, now: Date): Promise<PendingInvitation[]> {
  return tx
    .select({
      id: invitation.id,
      email: invitation.email,
      name: invitation.name,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .where(and(eq(invitation.type, "invitation"), isNull(invitation.usedAt), gt(invitation.expiresAt, now)))
    .orderBy(asc(invitation.createdAt));
}

export const validInvitation = z.object(
  {
    email: z.email("E-mail invalide").trim().toLowerCase().max(200, "E-mail : 200 caractères au plus"),
    name: z
      .string({ error: "Nom obligatoire" })
      .trim()
      .min(1, "Nom obligatoire")
      .max(100, "Nom : 100 caractères au plus"),
    role: z.enum(INVITABLE_ROLES, { error: "Choisissez un rôle." }),
  },
  { error: "Saisie invalide." },
);

/** Invites a person; an invitation still open for the same e-mail is replaced. */
export async function invite(
  tx: Tx,
  userId: string,
  entry: z.input<typeof validInvitation>,
  now: Date,
): Promise<RelationshipResult> {
  const s = validInvitation.safeParse(entry);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  const [already] = await tx
    .select({ active: member.active })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(user.email, s.data.email));
  if (already?.active) return { ok: false, message: "Cette personne fait déjà partie de l’équipe." };
  const replaced = await tx
    .delete(invitation)
    .where(and(eq(invitation.type, "invitation"), eq(invitation.email, s.data.email), isNull(invitation.usedAt)))
    .returning(LOGGED_LINK);
  await logLinks(tx, who, "delete", replaced);
  const token = newToken();
  const [created] = await tx
    .insert(invitation)
    .values({
      email: s.data.email,
      name: s.data.name,
      role: s.data.role,
      schoolId: CURRENT_SCHOOL,
      type: "invitation",
      tokenHash: hash(token),
      expiresAt: new Date(now.getTime() + INVITATION_DURATION),
      createdBy: who,
    })
    .returning(LOGGED_LINK);
  await logLinks(tx, who, "insert", [created]);
  return { ok: true, id: created.id, token };
}

/** Revokes an invitation not yet used: the link stops working immediately. */
export async function revokeInvitation(tx: Tx, userId: string, id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: "Cette invitation n’existe plus." };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  const rows = await tx
    .delete(invitation)
    .where(and(eq(invitation.id, id), isNull(invitation.usedAt)))
    .returning(LOGGED_LINK);
  await logLinks(tx, who, "delete", rows);
  return rows.length === 1 ? { ok: true, id } : { ok: false, message: "Cette invitation n’existe plus." };
}

/** Changes a member's role or active state (management), with the team's guards; recorded in the audit log. */
export async function updateMember(
  tx: Tx,
  userId: string,
  memberId: string,
  after: { role: Role; active: boolean },
): Promise<Result> {
  if (!isUuid(memberId) || !ROLE_VALUES.includes(after.role)) return { ok: false, message: "Ce membre n’existe plus." };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  const team = await tx.select({ id: member.id, role: member.role, active: member.active }).from(member);
  const refusal = changeRefusal(team, who, memberId, after);
  if (refusal) return { ok: false, message: refusal };
  const before = team.find((m) => m.id === memberId)!;
  const target = await memberAccount(tx, memberId);
  await tx.update(member).set({ role: after.role, active: after.active }).where(eq(member.id, memberId));
  if (!after.active || after.role !== "director") {
    // Their links stop working anyway (AUTHOR_STILL_DIRECTOR): removed so they leave the pending list too.
    const dropped = await tx
      .delete(invitation)
      .where(and(eq(invitation.createdBy, memberId), isNull(invitation.usedAt)))
      .returning(LOGGED_LINK);
    await logLinks(tx, who, "delete", dropped);
  }
  if (!after.active && target) {
    // A deactivated member has nothing to sign in to: their pending reset link goes too.
    const dropped = await tx
      .delete(invitation)
      .where(and(eq(invitation.type, "reset"), eq(invitation.userId, target), isNull(invitation.usedAt)))
      .returning(LOGGED_LINK);
    await logLinks(tx, who, "delete", dropped);
  }
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who,
    targetTable: "member",
    rowId: memberId,
    action: "update",
    before: { role: before.role, active: before.active },
    after,
  });
  return { ok: true, id: memberId };
}

/**
 * Password reset link for a member, valid for 24 hours;
 * refused if the account also belongs to another school (checked again when the
 * link is used).
 */
export async function resetLink(tx: Tx, userId: string, memberId: string, now: Date): Promise<RelationshipResult> {
  if (!isUuid(memberId)) return { ok: false, message: "Ce membre n’existe plus." };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  const [m] = await tx
    .select({ userId: member.userId, email: user.email, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.id, memberId), eq(member.active, true)));
  if (!m) return { ok: false, message: "Réactivez d’abord ce membre, ou il n’existe plus." };
  if (await elsewhereAccount(tx, m.userId)) return { ok: false, message: SHARED };
  const replaced = await tx
    .delete(invitation)
    .where(and(eq(invitation.type, "reset"), eq(invitation.userId, m.userId), isNull(invitation.usedAt)))
    .returning(LOGGED_LINK);
  await logLinks(tx, who, "delete", replaced);
  const token = newToken();
  const [created] = await tx
    .insert(invitation)
    .values({
      schoolId: CURRENT_SCHOOL,
      type: "reset",
      email: m.email,
      name: m.name,
      userId: m.userId,
      tokenHash: hash(token),
      expiresAt: new Date(now.getTime() + RESET_DURATION),
      createdBy: who,
    })
    .returning(LOGGED_LINK);
  await logLinks(tx, who, "insert", [created]);
  return { ok: true, id: created.id, token };
}

export type OpenedLink = {
  id: string;
  type: "invitation" | "reset";
  email: string;
  name: string | null;
  role: Role | null;
  userId: string | null;
  school: string;
};

/** Link still valid for this token (neither used nor expired), or null. */
export async function readRelationship(tx: Tx, token: string, now: Date): Promise<OpenedLink | null> {
  if (!TOKEN.test(token)) return null;
  const [l] = await tx
    .select({
      id: invitation.id,
      type: invitation.type,
      email: invitation.email,
      name: invitation.name,
      role: invitation.role,
      userId: invitation.userId,
      school: school.name,
    })
    .from(invitation)
    .innerJoin(school, eq(school.id, invitation.schoolId))
    .where(
      and(
        eq(invitation.tokenHash, hash(token)),
        isNull(invitation.usedAt),
        gt(invitation.expiresAt, now),
        AUTHOR_STILL_DIRECTOR,
      ),
    );
  return l ?? null;
}

/**
 * A new code proving the invited e-mail (#179) for an invitation still open:
 * returned once, in clear, to be e-mailed; only its hash is kept. It replaces
 * the previous one. Refused while the last one is younger than
 * `EMAIL_PROOF_RESEND_MS` (`wait`: seconds left).
 */
export async function newEmailCode(
  tx: Tx,
  link: OpenedLink,
  now: Date,
): Promise<{ ok: true; code: string } | { ok: false; wait: number } | null> {
  if (link.type !== "invitation") return null;
  // Spaced out per address and school (`addressWait`): re-inviting the same address does not
  // reset the count, and one school cannot use up another's share; a far higher ceiling holds
  // for all schools together. Global table, no RLS: only a hash of the address is kept, one row
  // per e-mail for 24 hours. The lock (per address) serialises two requests.
  const [own] = await tx.select({ schoolId: invitation.schoolId }).from(invitation).where(eq(invitation.id, link.id));
  if (!own) return null;
  const address = emailProofAddress(link.email);
  const sentTo = emailProofKey(link.email, own.schoolId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${address}))`);
  // A hash of an address is still personal data: rows past their 24 hours go.
  await tx
    .delete(verification)
    .where(and(like(verification.identifier, `${address}:%`), lte(verification.expiresAt, now)));
  const sent = await tx
    .select({ identifier: verification.identifier, at: verification.createdAt })
    .from(verification)
    .where(and(like(verification.identifier, `${address}:%`), gt(verification.expiresAt, now)));
  const wait = addressWait(
    { school: sent.filter((s) => s.identifier === sentTo).map((s) => s.at), all: sent.map((s) => s.at) },
    now,
  );
  if (wait > 0) return { ok: false, wait };
  const code = newToken();
  const recorded = await tx
    .update(invitation)
    .set({ emailCodeHash: hash(code), emailCodeSentAt: now })
    .where(
      and(
        eq(invitation.id, link.id),
        isNull(invitation.usedAt),
        gt(invitation.expiresAt, now),
        AUTHOR_STILL_DIRECTOR,
        or(
          isNull(invitation.emailCodeSentAt),
          lte(invitation.emailCodeSentAt, new Date(now.getTime() - EMAIL_PROOF_RESEND_MS)),
        ),
      ),
    )
    .returning({ id: invitation.id });
  if (recorded.length === 1) {
    await tx.insert(verification).values({
      id: randomUUID(),
      identifier: sentTo,
      value: hash(code),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true, code };
  }
  const [l] = await tx
    .select({ sentAt: invitation.emailCodeSentAt })
    .from(invitation)
    .where(and(eq(invitation.id, link.id), isNull(invitation.usedAt)));
  const left = l ? resendWait(l.sentAt, now) : 0;
  // Nothing to wait for: the invitation is no longer usable (expired, used, author left management).
  return left > 0 ? { ok: false, wait: left } : null;
}

/** Prefix of every e-mail proof in `verification`. */
const EMAIL_PROOF_PREFIX = "email-proof:";
/** Prefix of an address's e-mail proofs in `verification`: a hash, never the address itself. */
const emailProofAddress = (email: string) => `${EMAIL_PROOF_PREFIX}${hash(email.trim().toLowerCase())}`;

/**
 * Deletes the e-mail proofs past their 24 hours, of every address and school
 * (#404): an unsalted hash of an address is personal data, and an address
 * never e-mailed again would otherwise keep its rows forever. Global table, no
 * RLS: run by the nightly purge (`scripts/purge-submissions.ts`). Leaves
 * Better Auth's own rows alone. Returns the number of rows deleted.
 */
export async function purgeExpiredEmailProofs(): Promise<number> {
  const deleted = await db
    .delete(verification)
    .where(and(like(verification.identifier, `${EMAIL_PROOF_PREFIX}%`), lte(verification.expiresAt, sql`now()`)))
    .returning({ id: verification.id });
  return deleted.length;
}
/** Key of the e-mail proofs one school sent to an address. */
const emailProofKey = (email: string, schoolId: string) => `${emailProofAddress(email)}:${schoolId}`;

/** Withdraws a code that could not be e-mailed, so another one may be sent right away. */
export async function dropEmailCode(tx: Tx, link: OpenedLink, code: string): Promise<void> {
  await tx
    .update(invitation)
    .set({ emailCodeHash: null, emailCodeSentAt: null })
    .where(and(eq(invitation.id, link.id), eq(invitation.emailCodeHash, hash(code))));
  await tx
    .delete(verification)
    .where(
      and(like(verification.identifier, `${emailProofAddress(link.email)}:%`), eq(verification.value, hash(code))),
    );
}

/** Condition: `code` is the invitation's last e-mailed code, still valid at `now`. */
const emailCodeMatches = (code: string, now: Date) =>
  and(
    eq(invitation.emailCodeHash, hash(code)),
    gt(invitation.emailCodeSentAt, new Date(now.getTime() - EMAIL_PROOF_DURATION_MS)),
  );

/** Whether `code` is the open invitation's last e-mailed code, still valid. */
export async function emailCodeValid(tx: Tx, link: OpenedLink, code: string, now: Date): Promise<boolean> {
  if (link.type !== "invitation" || !TOKEN.test(code)) return false;
  const [l] = await tx
    .select({ id: invitation.id })
    .from(invitation)
    .where(and(eq(invitation.id, link.id), isNull(invitation.usedAt), emailCodeMatches(code, now)));
  return !!l;
}

/**
 * Marks the link used (once only) and, for an invitation, brings
 * the account into the team with the planned role. A reset is
 * refused if the account has joined another school since the link was created.
 * With `emailCode` (#179), only while that e-mailed code is still valid.
 *
 * With `credentials`, the account's new password (already hashed), its
 * verified e-mail and the closing of its sessions are written in the same
 * transaction, after locking the account (#179): a reset and an e-mail proof
 * of one account run one after the other, and nobody keeps an old password
 * or session in a school the account has just joined.
 */
export async function consumeLink(
  tx: Tx,
  relationship: OpenedLink,
  userId: string,
  emailCode?: { code: string; now: Date },
  credentials?: { passwordHash: string; verifiedEmail: boolean },
): Promise<"ok" | "expired" | "shared"> {
  if (emailCode && !TOKEN.test(emailCode.code)) return "expired";
  if (credentials) {
    const [locked] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
    if (!locked) return "expired";
  }
  if (relationship.type === "reset" && (await elsewhereAccount(tx, userId))) return "shared";
  const badge = await tx
    .update(invitation)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(invitation.id, relationship.id),
        isNull(invitation.usedAt),
        AUTHOR_STILL_DIRECTOR,
        emailCode ? emailCodeMatches(emailCode.code, emailCode.now) : undefined,
      ),
    )
    .returning({ id: invitation.id });
  if (badge.length !== 1) return "expired";
  if (relationship.type === "invitation" && relationship.role) {
    await tx
      .insert(member)
      .values({ schoolId: CURRENT_SCHOOL, userId, role: relationship.role })
      .onConflictDoUpdate({ target: [member.schoolId, member.userId], set: { role: relationship.role, active: true } });
  }
  if (credentials) {
    const changed = await tx
      .update(account)
      .set({ password: credentials.passwordHash, updatedAt: sql`now()` })
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
      .returning({ id: account.id });
    if (changed.length === 0)
      await tx.insert(account).values({
        id: randomUUID(),
        userId,
        providerId: "credential",
        accountId: userId,
        password: credentials.passwordHash,
      });
    if (credentials.verifiedEmail)
      await tx
        .update(user)
        .set({ emailVerified: true, updatedAt: sql`now()` })
        .where(eq(user.id, userId));
    // Sessions opened with the old password are closed.
    await tx.delete(session).where(eq(session.userId, userId));
  }
  return "ok";
}
