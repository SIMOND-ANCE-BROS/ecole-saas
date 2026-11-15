import { toNextJsHandler } from "better-auth/next-js";
import { AUTH_BASE_PATH, AUTH_HTTP_PATHS, auth } from "@/lib/auth";

const handler = toNextJsHandler(auth);

/**
 * Only the endpoints the browser uses are forwarded to Better Auth (#423); any
 * other path, built-in or added by an upgrade, is not found. Exact match: no
 * trailing slash, no path parameter. `disabledPaths` (auth.ts) closes them too,
 * except the paths with a parameter (`/callback/:id`, `/reset-password/:token`),
 * which only this filter closes.
 */
function forward(method: (request: Request) => Promise<Response>) {
  return (request: Request) => {
    const { pathname } = new URL(request.url);
    const served = AUTH_HTTP_PATHS.some((path) => pathname === `${AUTH_BASE_PATH}${path}`);
    return served ? method(request) : Promise.resolve(new Response(null, { status: 404 }));
  };
}

export const GET = forward(handler.GET);
export const POST = forward(handler.POST);
