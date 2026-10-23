import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { type SchoolContext, contextFromSession, type MemberRole } from "./school-access";
import { auth } from "./auth";

/**
 * Data access layer (DAL): to call in every protected page and server action,
 * as close to the data as possible (not in a layout, which is not re-run on
 * every navigation). Cached for the duration of a render.
 */

/** Valid session (checked in the database), otherwise redirect to sign-in. */
export const currentSession = cache(async () => {
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result) redirect("/connexion");
  return result;
});

/**
 * Current school, taken from the server-side session and re-checked (active
 * member); otherwise redirect to the school choice. To pass to withSchool().
 */
export const schoolContext = cache(async (): Promise<SchoolContext> => {
  const { session, user } = await currentSession();
  const context = await contextFromSession(user.id, session.selectedSchoolId);
  if (!context) redirect("/ecoles");
  return context;
});

/** Current school, provided the user has one of the required roles. */
export async function requireRole(...roles: MemberRole[]): Promise<SchoolContext> {
  const context = await schoolContext();
  if (!roles.includes(context.role)) redirect("/");
  return context;
}
