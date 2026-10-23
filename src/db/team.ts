import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { changeRefusal, type Role } from "../domain/team/rules";
import type { Tx } from "./index";
import { school, invitation, auditLog, member, user } from "./schema";

/**
 * Équipe d'une école (#104) : membres, invitations et liens de
 * réinitialisation. Le jeton d'un lien n'est rendu qu'une fois, à sa
 * création ; seule son empreinte est gardée. Toujours avec la transaction
 * d'`withSchool()` (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DAY = 86_400_000;
export const INVITATION_DURATION = 7 * DAY;
export const RESET_DURATION = DAY;

/** Rôles qu'on peut donner aujourd'hui ; les comptes professeurs viendront plus tard (#22). */
export const ROLES_INVITABLES = { direction: "Direction", accueil: "Accueil" } as const;
export const ROLES = { ...ROLES_INVITABLES, professeur: "Professeur" } as const;

export type Result = { ok: true; id: string } | { ok: false; message: string };
export type RelationshipResult = { ok: true; id: string; token: string } | { ok: false; message: string };

/** Membre actif de la direction : seul à gérer l'équipe (vérifié ici aussi, pas seulement par la page). */
async function memberOf(tx: Tx, userId: string) {
  const [m] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true), eq(member.role, "direction")));
  return m?.id ?? null;
}

/**
 * Le compte appartient-il (même désactivé) à une autre école ? Son mot de
 * passe y donne accès : une école ne doit pas pouvoir le changer pour une
 * autre. Lu dans la transaction courante grâce à la politique RLS
 * `my_memberships` (app.user_id), remise à vide aussitôt.
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
export const SHARED =
  "Ce compte sert aussi dans une autre école : la personne doit changer elle-même son mot de passe.";

/** Compte (global) d'un membre de l'école, ou null. */
export async function memberAccount(tx: Tx, memberId: string): Promise<string | null> {
  if (!isUuid(memberId)) return null;
  const [m] = await tx.select({ userId: member.userId }).from(member).where(eq(member.id, memberId));
  return m?.userId ?? null;
}

export type MemberListItem = { id: string; userId: string; name: string; email: string; role: Role; active: boolean };

/** Membres de l'école, actifs d'abord, par nom. */
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

/** Invitations ni utilisées ni expirées. */
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
  role: z.enum(Object.keys(ROLES_INVITABLES) as [keyof typeof ROLES_INVITABLES]),
});

/** Invite une personne ; une invitation encore ouverte pour le même e-mail est remplacée. */
export async function invite(
  tx: Tx,
  userId: string,
  saisie: z.input<typeof validInvitation>,
  now: Date,
): Promise<RelationshipResult> {
  const s = validInvitation.safeParse(saisie);
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

/** Révoque une invitation pas encore utilisée : le lien cesse aussitôt de fonctionner. */
export async function revokeInvitation(tx: Tx, id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: "Cette invitation n’existe plus." };
  const rows = await tx
    .delete(invitation)
    .where(and(eq(invitation.id, id), isNull(invitation.usedAt)))
    .returning({ id: invitation.id });
  return rows.length === 1 ? { ok: true, id } : { ok: false, message: "Cette invitation n’existe plus." };
}

/** Change le rôle ou l'activité d'un membre (direction), avec les garde-fous de l'équipe ; trace dans le journal. */
export async function updateMember(
  tx: Tx,
  userId: string,
  memberId: string,
  after: { role: Role; active: boolean },
): Promise<Result> {
  if (!isUuid(memberId) || !(after.role in ROLES)) return { ok: false, message: "Ce membre n’existe plus." };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  const team = await tx.select({ id: member.id, role: member.role, active: member.active }).from(member);
  const refusal = changeRefusal(team, who, memberId, after);
  if (refusal) return { ok: false, message: refusal };
  const before = team.find((m) => m.id === memberId)!;
  await tx.update(member).set({ role: after.role, active: after.active }).where(eq(member.id, memberId));
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
 * Lien de réinitialisation du mot de passe d'un membre, valable 24 heures ;
 * refusé si le compte appartient aussi à une autre école (revérifié quand le
 * lien est utilisé).
 */
export async function resetLink(tx: Tx, userId: string, memberId: string, now: Date): Promise<RelationshipResult> {
  if (!isUuid(memberId)) return { ok: false, message: "Ce membre n’existe plus." };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  const [m] = await tx
    .select({ userId: member.userId, email: user.email, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.id, memberId));
  if (!m) return { ok: false, message: "Ce membre n’existe plus." };
  if (await elsewhereAccount(tx, m.userId)) return { ok: false, message: SHARED };
  await tx
    .delete(invitation)
    .where(and(eq(invitation.type, "reinitialisation"), eq(invitation.userId, m.userId), isNull(invitation.usedAt)));
  const token = newToken();
  const [{ id }] = await tx
    .insert(invitation)
    .values({
      schoolId: CURRENT_SCHOOL,
      type: "reinitialisation",
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
  type: "invitation" | "reinitialisation";
  email: string;
  name: string | null;
  role: Role | null;
  userId: string | null;
  school: string;
};

/** Lien encore valable pour ce jeton (ni utilisé ni expiré), ou null. */
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
    .where(and(eq(invitation.tokenHash, hash(token)), isNull(invitation.usedAt), gt(invitation.expiresAt, now)));
  return l ?? null;
}

/**
 * Marque le lien utilisé (une seule fois) et, pour une invitation, fait
 * entrer le compte dans l'équipe avec le rôle prévu. Une réinitialisation est
 * refusée si le compte a rejoint une autre école depuis la création du lien.
 */
export async function consumeLink(
  tx: Tx,
  relationship: OpenedLink,
  userId: string,
): Promise<"ok" | "expire" | "partage"> {
  if (relationship.type === "reinitialisation" && (await elsewhereAccount(tx, userId))) return "partage";
  const badge = await tx
    .update(invitation)
    .set({ usedAt: sql`now()` })
    .where(and(eq(invitation.id, relationship.id), isNull(invitation.usedAt)))
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
