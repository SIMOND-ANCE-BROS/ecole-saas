import { auth } from "./auth";

/**
 * Crée un compte (e-mail + mot de passe) sans passer par l'inscription libre,
 * fermée. Réservé à l'administration (script de démonstration, futur écran des
 * membres) : le rattachement à une école se fait ensuite dans `membre`.
 */
export async function creerCompte(compte: {
  email: string;
  nom: string;
  motDePasse: string;
  emailVerifie?: boolean;
}): Promise<string> {
  const ctx = await auth.$context;
  const utilisateur = await ctx.internalAdapter.createUser(
    // Un compte créé par un lien d'invitation transmis à la main n'a pas prouvé son e-mail (#105).
    { email: compte.email.trim().toLowerCase(), name: compte.nom, emailVerified: compte.emailVerifie ?? true },
    { method: "admin" }, // compte créé par l'école, pas par inscription
  );
  await ctx.internalAdapter.linkAccount({
    userId: utilisateur.id,
    providerId: "credential",
    accountId: utilisateur.id,
    password: await ctx.password.hash(compte.motDePasse),
  });
  return utilisateur.id;
}
