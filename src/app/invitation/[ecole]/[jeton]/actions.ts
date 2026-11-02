"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { acceptEmailProof, acceptLink, openLink, sendEmailProof } from "@/lib/invitations";
import { clearAttempts, LIMITS, recordAttempt, trustedIp } from "@/lib/sign-in-limit";
import type { BANNERS } from "@/app/connexion/banners";
import { LINK } from "./fields";

export type LinkState = { error: string | null };

const EXPIRED = "Ce lien n’est plus valable. Demandez-en un nouveau à la direction de l’école.";

/**
 * Accepts an invitation or reset link (#104), without being signed in: the
 * token in the URL is the proof. `schoolId` and `token` come from the URL, bound
 * by the page; the school is only the one the link was created in.
 */
export async function submitLink(schoolId: string, token: string, _s: LinkState, f: FormData): Promise<LinkState> {
  if (!z.uuid().safeParse(schoolId).success) return { error: EXPIRED };
  const link = await openLink(schoolId, token);
  if (!link) return { error: EXPIRED };
  // Joining with an existing account checks its password: same attempt limit as the sign-in page.
  const confirming = link.proof === "password";
  const ip = trustedIp(await headers());
  if (confirming && !(await recordAttempt(link.email, ip))) {
    return { error: `Trop de tentatives. Réessayez dans ${LIMITS.windowMinutes} minutes.` };
  }
  const r = await acceptLink(schoolId, token, {
    name: LINK.read(f, "name"),
    password: LINK.read(f, "password"),
    confirmation: LINK.read(f, "confirmation"),
    currentPassword: LINK.read(f, "currentPassword"),
  });
  if (!r.ok) return { error: r.message };
  if (confirming) await clearAttempts(link.email, ip);
  const banner: keyof typeof BANNERS = r.type === "reset" ? "mot-de-passe" : "acces";
  redirect(`/connexion?lien=${banner}`);
}

/** `notice`: not an error, the person only has to wait before another e-mail. */
export type ProofRequestState = { error: string | null; notice: string | null; sent: boolean };

/**
 * E-mails the invited address a link proving it is theirs (#179). Only the
 * address of the invitation receives it: whoever holds the invitation link
 * cannot pick another one. Resending is spaced out per address (`addressWait`):
 * a refusal for that keeps what was already sent on screen, as a notice.
 */
export async function requestEmailProof(
  schoolId: string,
  token: string,
  previous: ProofRequestState,
): Promise<ProofRequestState> {
  if (!z.uuid().safeParse(schoolId).success) return { error: EXPIRED, notice: null, sent: false };
  const r = await sendEmailProof(schoolId, token);
  if (r.ok) return { error: null, notice: null, sent: true };
  if (r.tooSoon) return { error: null, notice: r.message, sent: previous.sent };
  return { error: r.message, notice: null, sent: false };
}

/**
 * Joins the school after opening the e-mailed link (#179): the code in the URL
 * proves the address, the person chooses the account's password.
 */
export async function submitEmailProof(
  schoolId: string,
  token: string,
  code: string,
  _s: LinkState,
  f: FormData,
): Promise<LinkState> {
  if (!z.uuid().safeParse(schoolId).success) return { error: EXPIRED };
  const r = await acceptEmailProof(schoolId, token, code, {
    password: LINK.read(f, "password"),
    confirmation: LINK.read(f, "confirmation"),
  });
  if (!r.ok) return { error: r.message };
  redirect(`/connexion?lien=${"acces" satisfies keyof typeof BANNERS}`);
}
