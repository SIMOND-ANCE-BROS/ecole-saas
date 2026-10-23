import { auth } from "./auth";

/**
 * Creates an account (e-mail + password) without going through open sign-up,
 * which is closed. Reserved for administration (demo script, future members
 * screen): the link to a school is then made in `member`.
 */
export async function createAccount(account: {
  email: string;
  name: string;
  password: string;
  emailVerified?: boolean;
}): Promise<string> {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    // An account created through an invitation link passed on by hand has not proven its e-mail (#105).
    { email: account.email.trim().toLowerCase(), name: account.name, emailVerified: account.emailVerified ?? true },
    { method: "admin" }, // account created by the school, not by sign-up
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(account.password),
  });
  return user.id;
}
