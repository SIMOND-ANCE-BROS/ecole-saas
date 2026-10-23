import { auth } from "./auth";

/**
 * Crée un compte (e-mail + mot de passe) sans passer par l'inscription libre,
 * fermée. Réservé à l'administration (script de démonstration, futur écran des
 * membres) : le rattachement à une école se fait ensuite dans `membre`.
 */
export async function createAccount(account: {
  email: string;
  name: string;
  password: string;
  emailVerified?: boolean;
}): Promise<string> {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    // Un compte créé par un lien d'invitation transmis à la main n'a pas prouvé son e-mail (#105).
    { email: account.email.trim().toLowerCase(), name: account.name, emailVerified: account.emailVerified ?? true },
    { method: "admin" }, // compte créé par l'école, pas par inscription
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(account.password),
  });
  return user.id;
}
