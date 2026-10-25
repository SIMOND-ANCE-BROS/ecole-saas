import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schoolsOf } from "../db";
import { session } from "../db/schema";
import type { Role } from "../domain/team/rules";

export type MemberRole = Role;

/** What a business query needs: who, in which school, with which role. */
export type SchoolContext = { userId: string; schoolId: string; role: MemberRole };

const uuid = z.uuid();

/**
 * Saves the chosen school on the session, only if the user is an active
 * member of it and the session belongs to them. The id offered by the
 * browser is never used as is: it must appear in `schoolsOf`.
 */
export async function chooseSchool(sessionId: string, userId: string, schoolId: string): Promise<boolean> {
  if (!(await membership(userId, schoolId))) return false;
  const modified = await db
    .update(session)
    .set({ selectedSchoolId: schoolId, updatedAt: new Date() })
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .returning({ id: session.id });
  return modified.length === 1;
}

/**
 * Context of the current school, re-checked on every request: null if no
 * school is chosen or if access has been revoked since.
 */
export async function contextFromSession(
  userId: string,
  selectedSchoolId: string | null | undefined,
): Promise<SchoolContext | null> {
  if (!selectedSchoolId) return null;
  const member = await membership(userId, selectedSchoolId);
  return member ? { userId, schoolId: selectedSchoolId, role: member.role } : null;
}

/** Id of the session carrying this token (returned by sign-in). */
export async function sessionIdOf(token: string): Promise<string | null> {
  const [row] = await db.select({ id: session.id }).from(session).where(eq(session.token, token));
  return row?.id ?? null;
}

async function membership(userId: string, schoolId: string) {
  if (!uuid.safeParse(schoolId).success) return null;
  const schools = await schoolsOf(userId);
  return schools.find((e) => e.id === schoolId) ?? null;
}
