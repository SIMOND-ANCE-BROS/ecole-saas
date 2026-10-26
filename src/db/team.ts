import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { changeRefusal, INVITABLE_ROLES, ROLE_VALUES, type Role } from "../domain/team/rules";
import type { Tx } from "./index";
import { school, invitation, auditLog, member, user } from "./schema";

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

export const validInvitation = z.object({
  email: z.email("E-mail invalide").trim().toLowerCase().max(200),
  name: z.string().trim().min(1, "Nom obligatoire").max(100),
  role: z.enum(INVITABLE_ROLES),
});

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
  await tx
    .delete(invitation)
    .where(and(eq(invitation.type, "invitation"), eq(invitation.email, s.data.email), isNull(invitation.usedAt)));
  const token = newToken();
  const [{ id }] = await tx
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
    .returning({ id: invitation.id });
  return { ok: true, id, token };
}

/** Revokes an invitation not yet used: the link stops working immediately. */
export async function revokeInvitation(tx: Tx, id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: "Cette invitation n’existe plus." };
  const rows = await tx
    .delete(invitation)
    .where(and(eq(invitation.id, id), isNull(invitation.usedAt)))
    .returning({ id: invitation.id });
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
    await tx.delete(invitation).where(and(eq(invitation.createdBy, memberId), isNull(invitation.usedAt)));
  }
  if (!after.active && target) {
    // A deactivated member has nothing to sign in to: their pending reset link goes too.
    await tx
      .delete(invitation)
      .where(and(eq(invitation.type, "reset"), eq(invitation.userId, target), isNull(invitation.usedAt)));
  }
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who,
    targetTable: "member",
    rowId: memberId,
    action: "update",
    before: { role: before.role, active: before.active },
    after: after,
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
  await tx
    .delete(invitation)
    .where(and(eq(invitation.type, "reset"), eq(invitation.userId, m.userId), isNull(invitation.usedAt)));
  const token = newToken();
  const [{ id }] = await tx
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
    .returning({ id: invitation.id });
  return { ok: true, id, token };
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
 * Marks the link used (once only) and, for an invitation, brings
 * the account into the team with the planned role. A reset is
 * refused if the account has joined another school since the link was created.
 */
export async function consumeLink(
  tx: Tx,
  relationship: OpenedLink,
  userId: string,
): Promise<"ok" | "expire" | "partage"> {
  if (relationship.type === "reset" && (await elsewhereAccount(tx, userId))) return "partage";
  const badge = await tx
    .update(invitation)
    .set({ usedAt: sql`now()` })
    .where(and(eq(invitation.id, relationship.id), isNull(invitation.usedAt), AUTHOR_STILL_DIRECTOR))
    .returning({ id: invitation.id });
  if (badge.length !== 1) return "expire";
  if (relationship.type === "invitation" && relationship.role) {
    await tx
      .insert(member)
      .values({ schoolId: CURRENT_SCHOOL, userId, role: relationship.role })
      .onConflictDoUpdate({ target: [member.schoolId, member.userId], set: { role: relationship.role, active: true } });
  }
  return "ok";
}
