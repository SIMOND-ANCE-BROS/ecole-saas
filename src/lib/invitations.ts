import { avecEcole } from "../db";
import { type LienOuvert, lienReinitialisation, lireLien, PARTAGE, utiliserLien } from "../db/equipe";
import { refusMotDePasse } from "../domaine/equipe/regles";
import { auth } from "./auth";
import { creerCompte } from "./comptes";

/**
 * Acceptation d'un lien d'invitation ou de réinitialisation (#104), ouvert
 * sans être connecté : le jeton (dans l'adresse) en est la seule preuve. Le
 * compte (global, Better Auth) est créé ou mis à jour, puis l'appartenance à
 * l'école est enregistrée sous RLS.
 */

export type SaisieLien = { nom: string; motDePasse: string; confirmation: string; motDePasseActuel: string };
export type ResultatLien = { ok: true; type: LienOuvert["type"]; email: string } | { ok: false; message: string };

const EXPIRE = "Ce lien n’est plus valable (déjà utilisé, révoqué ou expiré). Demandez-en un nouveau à la direction de l’école.";

/** Le lien, et si un compte existe déjà pour son e-mail (qui doit alors confirmer son mot de passe actuel). */
export async function ouvrirLien(ecoleId: string, jeton: string): Promise<(LienOuvert & { compteExistant: boolean }) | null> {
  const lien = await avecEcole(ecoleId, (tx) => lireLien(tx, jeton, new Date()));
  if (!lien) return null;
  const ctx = await auth.$context;
  const compteExistant = lien.type === "invitation" ? !!(await ctx.internalAdapter.findUserByEmail(lien.email)) : true;
  return { ...lien, compteExistant };
}

export async function accepterLien(ecoleId: string, jeton: string, saisie: SaisieLien): Promise<ResultatLien> {
  const lien = await avecEcole(ecoleId, (tx) => lireLien(tx, jeton, new Date()));
  if (!lien) return { ok: false, message: EXPIRE };
  const ctx = await auth.$context;
  let userId: string;

  if (lien.type === "reinitialisation") {
    const refus = refusMotDePasse(saisie.motDePasse, saisie.confirmation);
    if (refus) return { ok: false, message: refus };
    if (!lien.userId) return { ok: false, message: EXPIRE };
    userId = lien.userId;
  } else {
    const existant = await ctx.internalAdapter.findUserByEmail(lien.email);
    if (existant) {
      // Déjà un compte (dans une autre école) : il prouve qu'il en est le titulaire.
      const credentiel = await ctx.internalAdapter.findCredentialAccount(existant.user.id);
      const bon = credentiel?.password ? await ctx.password.verify({ password: saisie.motDePasseActuel, hash: credentiel.password }) : false;
      if (!bon) return { ok: false, message: "Mot de passe actuel incorrect." };
      userId = existant.user.id;
    } else {
      const refus = refusMotDePasse(saisie.motDePasse, saisie.confirmation);
      if (refus) return { ok: false, message: refus };
      const nom = saisie.nom.trim() || lien.nom || lien.email;
      if (nom.length > 100) return { ok: false, message: "Nom trop long." };
      // Relu juste avant la création : un lien utilisé entre-temps ne crée pas de compte orphelin.
      if (!(await avecEcole(ecoleId, (tx) => lireLien(tx, jeton, new Date())))) return { ok: false, message: EXPIRE };
      userId = await creerCompte({ email: lien.email, nom, motDePasse: saisie.motDePasse, emailVerifie: false });
    }
  }

  // Vérification et marquage dans la même transaction, juste avant de changer le mot de passe.
  const utilise = await avecEcole(ecoleId, (tx) => utiliserLien(tx, lien, userId));
  if (utilise === "partage") return { ok: false, message: PARTAGE };
  if (utilise !== "ok") return { ok: false, message: EXPIRE };
  if (lien.type === "reinitialisation") {
    await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(saisie.motDePasse));
    // Les sessions ouvertes avec l'ancien mot de passe sont fermées.
    await ctx.internalAdapter.deleteUserSessions(userId);
  }
  return { ok: true, type: lien.type, email: lien.email };
}

/** Lien de réinitialisation pour un membre (direction) ; refusé pour un compte qui sert aussi dans une autre école. */
export function creerLienReinitialisation(ecoleId: string, userId: string, membreId: string) {
  return avecEcole(ecoleId, (tx) => lienReinitialisation(tx, userId, membreId, new Date()));
}
