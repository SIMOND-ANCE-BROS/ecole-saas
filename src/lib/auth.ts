import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "../db";
import { account, session, user, verification } from "../db/schema";

/** Where the public route lives (`src/app/api/auth/[...all]/route.ts`). */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * The only Better Auth endpoint the browser calls over HTTP (#423): `/get-session`,
 * read by the lists to tell an expired session (`_filters/list-table.tsx`).
 * Everything else goes through the server, where `disabledPaths` does not apply
 * (it is checked by the HTTP router only): sign-in (`auth.api.signInEmail` in the
 * sign-in action, with its own limiter, sign-in-limit.ts), sign-out
 * (`auth.api.signOut`), session reading (`auth.api.getSession`, session.ts), the
 * session cookie (`getSessionCookie`, proxy.ts) and password hashing
 * (`ctx.password`, accounts.ts and invitations.ts). Password reset and the
 * invitation e-mail proof are our own (team.ts, #404, ADR 0008).
 */
export const AUTH_HTTP_PATHS: readonly string[] = ["/get-session"];

/**
 * Every other built-in endpoint of Better Auth 1.7 with our config, closed over
 * HTTP: they bypass our forms and their guarantees (audit, sessions closed with
 * a password change, #404). Paths with a parameter (`/callback/:id`,
 * `/reset-password/:token`) cannot be listed here (exact match): the route
 * itself only forwards `AUTH_HTTP_PATHS`. A Better Auth upgrade adding an
 * endpoint fails `route.integration.test.ts` until it is listed here.
 */
const DISABLED_AUTH_PATHS = [
  // Sign-in, sign-up, sign-out: server actions only.
  "/sign-in/email",
  "/sign-in/social",
  "/sign-up/email",
  "/sign-out",
  // Account: password, e-mail, name, deletion.
  "/change-password",
  "/verify-password",
  "/request-password-reset",
  "/reset-password",
  "/change-email",
  "/send-verification-email",
  "/verify-email",
  "/update-user",
  "/delete-user",
  "/delete-user/callback",
  // Sessions.
  "/update-session",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  // Social accounts and their tokens (no provider configured).
  "/link-social",
  "/list-accounts",
  "/unlink-account",
  "/refresh-token",
  "/get-access-token",
  "/account-info",
  // Health check and error page.
  "/ok",
  "/error",
] as const;

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
  basePath: AUTH_BASE_PATH,
  disabledPaths: [...DISABLED_AUTH_PATHS],
  session: {
    additionalFields: {
      // Set server-side only (chooseSchool), never by the browser.
      selectedSchoolId: { type: "string", required: false, input: false },
    },
  },
  // Must stay the last plugin: sets cookies from server actions.
  plugins: [nextCookies()],
});
