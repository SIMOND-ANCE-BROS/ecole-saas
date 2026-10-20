import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Redirection OPTIMISTE vers la connexion quand aucun cookie de session n'est
 * présent. Ce n'est pas une protection : la session est vérifiée en base par
 * la couche d'accès (src/lib/session.ts) dans chaque page et chaque action.
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
