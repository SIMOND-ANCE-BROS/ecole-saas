import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { refusChangement, type Role } from "../domaine/equipe/regles";
import type { Tx } from "./index";
import { ecole, invitation, journal, membre, user } from "./schema";

/**
 * Équipe d'une école (#104) : membres, invitations et liens de
 * réinitialisation. Le jeton d'un lien n'est rendu qu'une fois, à sa
 * création ; seule son empreinte est gardée. Toujours avec la transaction
 * d'`avecEcole()` (RLS).
 */

const ECOLE_COURANTE = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const estUuid = (v: string) => z.uuid().safeParse(v).success;
const empreinte = (jeton: string) => createHash("sha256").update(jeton).digest("hex");
const nouveauJeton = () => randomBytes(32).toString("base64url");
const JETON = /^[A-Za-z0-9_-]{43}$/;
const JOUR = 86_400_000;
export const DUREE_INVITATION = 7 * JOUR;
export const DUREE_REINITIALISATION = JOUR;

/** Rôles qu'on peut donner aujourd'hui ; les comptes professeurs viendront plus tard (#22). */
export const ROLES_INVITABLES = { direction: "Direction", accueil: "Accueil" } as const;
export const ROLES = { ...ROLES_INVITABLES, professeur: "Professeur" } as const;

export type Resultat = { ok: true; id: string } | { ok: false; message: string };
export type ResultatLien = { ok: true; id: string; jeton: string } | { ok: false; message: string };

/** Membre actif de la direction : seul à gérer l'équipe (vérifié ici aussi, pas seulement par la page). */
async function membreDe(tx: Tx, userId: string) {
  const [m] = await tx
    .select({ id: membre.id })
    .from(membre)
    .where(and(eq(membre.userId, userId), eq(membre.actif, true), eq(membre.role, "direction")));
  return m?.id ?? null;
}

/**
 * Le compte appartient-il (même désactivé) à une autre école ? Son mot de
 * passe y donne accès : une école ne doit pas pouvoir le changer pour une
 * autre. Lu dans la transaction courante grâce à la politique RLS
 * `mes_appartenances` (app.user_id), remise à vide aussitôt.
 */
async function compteAilleurs(tx: Tx, userId: string): Promise<boolean> {
  await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(membre)
    .where(and(eq(membre.userId, userId), sql`${membre.ecoleId} <> ${ECOLE_COURANTE}`));
  await tx.execute(sql`select set_config('app.user_id', '', true)`);
  return n > 0;
}
export const PARTAGE =
  "Ce compte sert aussi dans une autre école : la personne doit changer elle-même son mot de passe.";

/** Compte (global) d'un membre de l'école, ou null. */
export async function compteDuMembre(tx: Tx, membreId: string): Promise<string | null> {
  if (!estUuid(membreId)) return null;
  const [m] = await tx.select({ userId: membre.userId }).from(membre).where(eq(membre.id, membreId));
  return m?.userId ?? null;
}

export type MembreListe = { id: string; userId: string; nom: string; email: string; role: Role; actif: boolean };

/** Membres de l'école, actifs d'abord, par nom. */
export function listerMembres(tx: Tx): Promise<MembreListe[]> {
  return tx
    .select({
      id: membre.id,
      userId: membre.userId,
      nom: user.name,
      email: user.email,
      role: membre.role,
      actif: membre.actif,
    })
    .from(membre)
    .innerJoin(user, eq(user.id, membre.userId))
    .orderBy(sql`${membre.actif} DESC`, asc(user.name));
}

export type InvitationEnCours = { id: string; email: string; nom: string | null; role: Role | null; expireLe: Date };

/** Invitations ni utilisées ni expirées. */
export function invitationsEnCours(tx: Tx, maintenant: Date): Promise<InvitationEnCours[]> {
  return tx
    .select({
      id: invitation.id,
      email: invitation.email,
      nom: invitation.nom,
      role: invitation.role,
      expireLe: invitation.expireLe,
    })
    .from(invitation)
    .where(and(eq(invitation.type, "invitation"), isNull(invitation.utiliseLe), gt(invitation.expireLe, maintenant)))
    .orderBy(asc(invitation.creeLe));
}

export const invitationValide = z.object({
  email: z.email("E-mail invalide").trim().toLowerCase().max(200),
  nom: z.string().trim().min(1, "Nom obligatoire").max(100),
  role: z.enum(Object.keys(ROLES_INVITABLES) as [keyof typeof ROLES_INVITABLES]),
});

/** Invite une personne ; une invitation encore ouverte pour le même e-mail est remplacée. */
export async function inviter(
  tx: Tx,
  userId: string,
  saisie: z.input<typeof invitationValide>,
  maintenant: Date,
): Promise<ResultatLien> {
  const s = invitationValide.safeParse(saisie);
  if (!s.success) return { ok: false, message: s.error.issues[0].message };
  const qui = await membreDe(tx, userId);
  if (!qui) return { ok: false, message: "Accès refusé." };
  const [deja] = await tx
    .select({ actif: membre.actif })
    .from(membre)
    .innerJoin(user, eq(user.id, membre.userId))
    .where(eq(user.email, s.data.email));
  if (deja?.actif) return { ok: false, message: "Cette personne fait déjà partie de l’équipe." };
  await tx
    .delete(invitation)
    .where(and(eq(invitation.type, "invitation"), eq(invitation.email, s.data.email), isNull(invitation.utiliseLe)));
  const jeton = nouveauJeton();
  const [{ id }] = await tx
    .insert(invitation)
    .values({
      ...s.data,
      ecoleId: ECOLE_COURANTE,
      type: "invitation",
      jetonHash: empreinte(jeton),
      expireLe: new Date(maintenant.getTime() + DUREE_INVITATION),
      creePar: qui,
    })
    .returning({ id: invitation.id });
  return { ok: true, id, jeton };
}

/** Révoque une invitation pas encore utilisée : le lien cesse aussitôt de fonctionner. */
export async function revoquerInvitation(tx: Tx, id: string): Promise<Resultat> {
  if (!estUuid(id)) return { ok: false, message: "Cette invitation n’existe plus." };
  const lignes = await tx
    .delete(invitation)
    .where(and(eq(invitation.id, id), isNull(invitation.utiliseLe)))
    .returning({ id: invitation.id });
  return lignes.length === 1 ? { ok: true, id } : { ok: false, message: "Cette invitation n’existe plus." };
}

/** Change le rôle ou l'activité d'un membre (direction), avec les garde-fous de l'équipe ; trace dans le journal. */
export async function modifierMembre(
  tx: Tx,
  userId: string,
  membreId: string,
  apres: { role: Role; actif: boolean },
): Promise<Resultat> {
  if (!estUuid(membreId) || !(apres.role in ROLES)) return { ok: false, message: "Ce membre n’existe plus." };
  const qui = await membreDe(tx, userId);
  if (!qui) return { ok: false, message: "Accès refusé." };
  const equipe = await tx.select({ id: membre.id, role: membre.role, actif: membre.actif }).from(membre);
  const refus = refusChangement(equipe, qui, membreId, apres);
  if (refus) return { ok: false, message: refus };
  const avant = equipe.find((m) => m.id === membreId)!;
  await tx.update(membre).set(apres).where(eq(membre.id, membreId));
  await tx.insert(journal).values({
    ecoleId: ECOLE_COURANTE,
    qui,
    tableCible: "member",
    ligneId: membreId,
    action: "update",
    avant: { role: avant.role, actif: avant.actif },
    apres,
  });
  return { ok: true, id: membreId };
}

/**
 * Lien de réinitialisation du mot de passe d'un membre, valable 24 heures ;
 * refusé si le compte appartient aussi à une autre école (revérifié quand le
 * lien est utilisé).
 */
export async function lienReinitialisation(
  tx: Tx,
  userId: string,
  membreId: string,
  maintenant: Date,
): Promise<ResultatLien> {
  if (!estUuid(membreId)) return { ok: false, message: "Ce membre n’existe plus." };
  const qui = await membreDe(tx, userId);
  if (!qui) return { ok: false, message: "Accès refusé." };
  const [m] = await tx
    .select({ userId: membre.userId, email: user.email, nom: user.name })
    .from(membre)
    .innerJoin(user, eq(user.id, membre.userId))
    .where(eq(membre.id, membreId));
  if (!m) return { ok: false, message: "Ce membre n’existe plus." };
  if (await compteAilleurs(tx, m.userId)) return { ok: false, message: PARTAGE };
  await tx
    .delete(invitation)
    .where(and(eq(invitation.type, "reinitialisation"), eq(invitation.userId, m.userId), isNull(invitation.utiliseLe)));
  const jeton = nouveauJeton();
  const [{ id }] = await tx
    .insert(invitation)
    .values({
      ecoleId: ECOLE_COURANTE,
      type: "reinitialisation",
      email: m.email,
      nom: m.nom,
      userId: m.userId,
      jetonHash: empreinte(jeton),
      expireLe: new Date(maintenant.getTime() + DUREE_REINITIALISATION),
      creePar: qui,
    })
    .returning({ id: invitation.id });
  return { ok: true, id, jeton };
}

export type LienOuvert = {
  id: string;
  type: "invitation" | "reinitialisation";
  email: string;
  nom: string | null;
  role: Role | null;
  userId: string | null;
  ecole: string;
};

/** Lien encore valable pour ce jeton (ni utilisé ni expiré), ou null. */
export async function lireLien(tx: Tx, jeton: string, maintenant: Date): Promise<LienOuvert | null> {
  if (!JETON.test(jeton)) return null;
  const [l] = await tx
    .select({
      id: invitation.id,
      type: invitation.type,
      email: invitation.email,
      nom: invitation.nom,
      role: invitation.role,
      userId: invitation.userId,
      ecole: ecole.nom,
    })
    .from(invitation)
    .innerJoin(ecole, eq(ecole.id, invitation.ecoleId))
    .where(
      and(
        eq(invitation.jetonHash, empreinte(jeton)),
        isNull(invitation.utiliseLe),
        gt(invitation.expireLe, maintenant),
      ),
    );
  return l ?? null;
}

/**
 * Marque le lien utilisé (une seule fois) et, pour une invitation, fait
 * entrer le compte dans l'équipe avec le rôle prévu. Une réinitialisation est
 * refusée si le compte a rejoint une autre école depuis la création du lien.
 */
export async function utiliserLien(tx: Tx, lien: LienOuvert, userId: string): Promise<"ok" | "expire" | "partage"> {
  if (lien.type === "reinitialisation" && (await compteAilleurs(tx, userId))) return "partage";
  const marque = await tx
    .update(invitation)
    .set({ utiliseLe: sql`now()` })
    .where(and(eq(invitation.id, lien.id), isNull(invitation.utiliseLe)))
    .returning({ id: invitation.id });
  if (marque.length !== 1) return "expire";
  if (lien.type === "invitation" && lien.role) {
    await tx
      .insert(membre)
      .values({ ecoleId: ECOLE_COURANTE, userId, role: lien.role })
      .onConflictDoUpdate({ target: [membre.ecoleId, membre.userId], set: { role: lien.role, actif: true } });
  }
  return "ok";
}
