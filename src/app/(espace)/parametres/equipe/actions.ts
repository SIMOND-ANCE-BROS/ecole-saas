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

export async function inviteMember(entry: unknown): Promise<LinkBack> {
  const { schoolId, userId } = await requireRole("director");
  const parsed = validInvitation.safeParse(entry);
  if (!parsed.success) return { ok: false, message: "Indiquez le nom, l’e-mail et le rôle." };
  const r = await withSchool(schoolId, (tx) => invite(tx, userId, parsed.data, new Date()));
  revalidatePath(PATH);
  return r.ok ? { ok: true, link: linkAddress(schoolId, r.token) } : r;
}

export async function revoke(invitationId: string): Promise<Back> {
  const { schoolId } = await requireRole("director");
  const r = await withSchool(schoolId, (tx) => revokeInvitation(tx, invitationId));
  revalidatePath(PATH);
  return r.ok ? { ok: true } : r;
}

/** New role or active state of a member; the guards (oneself, last management) are in updateMember. */
export async function changeMember(memberId: string, after: unknown): Promise<Back> {
  const { schoolId, userId } = await requireRole("director");
  const parsed = validChange.safeParse(after);
  if (!parsed.success) return { ok: false, message: "Choisissez un rôle." };
  const r = await withSchool(schoolId, (tx) => updateMember(tx, userId, memberId, parsed.data));
  revalidatePath(PATH);
  return r.ok ? { ok: true } : r;
}

export async function resetPassword(memberId: string): Promise<LinkBack> {
  const { schoolId, userId } = await requireRole("director");
  const r = await createResetLink(schoolId, userId, memberId);
  return r.ok ? { ok: true, link: linkAddress(schoolId, r.token) } : r;
}
