import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "../db";
import { account, session, user, verification } from "../db/schema";

/**
 * Authentication (Better Auth): e-mail and password, sessions in the database.
 * No open sign-up: accounts are created by the school (`createAccount`).
 * Secret and URL: BETTER_AUTH_SECRET, BETTER_AUTH_URL (see .env.example).
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  // Origins accepted in addition to BETTER_AUTH_URL (e.g. access by the machine's IP locally).
  trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  // Single entry point: sign-in goes through the server action, which limits
  // attempts (sign-in-limit.ts). The public HTTP route is closed.
  disabledPaths: ["/sign-in/email"],
  session: {
    additionalFields: {
      // Set server-side only (chooseSchool), never by the browser.
      selectedSchoolId: { type: "string", required: false, input: false },
    },
  },
  // Must stay the last plugin: sets cookies from server actions.
  plugins: [nextCookies()],
});
