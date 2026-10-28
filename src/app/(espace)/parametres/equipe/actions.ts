"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSchool } from "@/db";
import { invite, revokeInvitation, updateMember, validInvitation } from "@/db/team";
import { ROLE_VALUES } from "@/domain/team/rules";
import { createResetLink, linkAddress } from "@/lib/invitations";
import { requireRole } from "@/lib/session";

/** A link is shown once: only its hash is stored. */
export type LinkBack = { ok: true; link: string } | { ok: false; message: string };
export type Back = { ok: true } | { ok: false; message: string };

const PATH = "/parametres/equipe";
const validChange = z.object({ role: z.enum(ROLE_VALUES), active: z.boolean() });
// Typed for the call sites; still parsed, since a server action receives whatever the browser sends.
const validId = z.uuid();
const MEMBER_GONE = "Ce membre n’existe plus.";

export async function inviteMember(entry: z.input<typeof validInvitation>): Promise<LinkBack> {
  const { schoolId, userId } = await requireRole("director");
  const parsed = validInvitation.safeParse(entry);
  // The schema's French messages (« Nom obligatoire », « E-mail invalide »).
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const r = await withSchool(schoolId, (tx) => invite(tx, userId, parsed.data, new Date()));
  revalidatePath(PATH);
  return r.ok ? { ok: true, link: linkAddress(schoolId, r.token) } : r;
}

export async function revoke(invitationId: string): Promise<Back> {
  const { schoolId, userId } = await requireRole("director");
  if (!validId.safeParse(invitationId).success) return { ok: false, message: "Cette invitation n’existe plus." };
  const r = await withSchool(schoolId, (tx) => revokeInvitation(tx, userId, invitationId));
  revalidatePath(PATH);
  return r.ok ? { ok: true } : r;
}

/** New role or active state of a member; the guards (oneself, last management) are in updateMember. */
export async function changeMember(memberId: string, after: z.input<typeof validChange>): Promise<Back> {
  const { schoolId, userId } = await requireRole("director");
  if (!validId.safeParse(memberId).success) return { ok: false, message: MEMBER_GONE };
  const parsed = validChange.safeParse(after);
  if (!parsed.success) return { ok: false, message: "Choisissez un rôle." };
  const r = await withSchool(schoolId, (tx) => updateMember(tx, userId, memberId, parsed.data));
  revalidatePath(PATH);
  return r.ok ? { ok: true } : r;
}

export async function resetPassword(memberId: string): Promise<LinkBack> {
  const { schoolId, userId } = await requireRole("director");
  if (!validId.safeParse(memberId).success) return { ok: false, message: MEMBER_GONE };
  const r = await createResetLink(schoolId, userId, memberId);
  return r.ok ? { ok: true, link: linkAddress(schoolId, r.token) } : r;
}
