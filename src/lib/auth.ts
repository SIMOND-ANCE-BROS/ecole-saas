import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "../db";
import { account, session, user, verification } from "../db/schema";

/**
 * Authentification (Better Auth) : e-mail et mot de passe, sessions en base.
 * Pas d'inscription libre : les comptes sont créés par l'école (`creerCompte`).
 * Secret et URL : BETTER_AUTH_SECRET, BETTER_AUTH_URL (voir .env.example).
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  // Porte d'entrée unique : la connexion passe par la server action, qui limite
  // les tentatives (limite-connexion.ts). La route HTTP publique est fermée.
  disabledPaths: ["/sign-in/email"],
  session: {
    additionalFields: {
      // Fixée côté serveur seulement (choisirEcole), jamais par le navigateur.
      ecoleChoisie: { type: "string", required: false, input: false },
    },
  },
  // Doit rester le dernier plugin : pose les cookies depuis les server actions.
  plugins: [nextCookies()],
});
