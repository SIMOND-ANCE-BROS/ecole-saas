import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * OPTIMISTIC redirect to sign-in when no session cookie is present.
 * This is not protection: the session is checked against the database by
 * the access layer (src/lib/session.ts) in every page and every action.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/connexion", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|connexion|agenda|mon-agenda|_next/static|_next/image|favicon.ico).*)"],
};
