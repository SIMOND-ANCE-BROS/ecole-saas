import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTH_HTTP_PATHS, auth } from "@/lib/auth";
import { createAccount } from "@/lib/accounts";
import { GET, POST } from "./route";

/**
 * The public Better Auth route only answers what the browser uses (#423):
 * every other built-in endpoint (change the password, edit the account, list
 * or close sessions…) bypasses our own forms and their guarantees (#404), so
 * it is refused even with a valid session. Server-side calls (`auth.api.*`:
 * sign-in action, session reading, sign-out) keep working. Fictitious account
 * deleted at the end.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const email = `zz-routes-auth-${suffix}@exemple.test`;
const PASSWORD = "un mot de passe de test";
let userId: string;
let cookie: string;
let base: string;
let origin: string;

type RoutedEndpoint = {
  path?: string;
  options: { method: string | readonly string[]; metadata?: Record<string, unknown> };
};

/** Signs in server-side, as the sign-in action does; returns the session cookie. */
async function signIn() {
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    headers: new Headers({ origin }),
    returnHeaders: true,
  });
  const set = headers.getSetCookie().map((c) => c.split(";")[0]);
  expect(set.length).toBeGreaterThan(0);
  return set.join("; ");
}

function request(method: "GET" | "POST", path: string, body?: unknown) {
  return new Request(`${base}${path}`, {
    method,
    headers: { cookie, origin, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Through the public route, as the browser does. */
function call(method: "GET" | "POST", path: string, body?: unknown) {
  const r = request(method, path, body);
  return method === "GET" ? GET(r) : POST(r);
}

beforeAll(async () => {
  const ctx = await auth.$context;
  base = ctx.baseURL;
  origin = new URL(base).origin;
  userId = await createAccount({ email, name: "Zz Routes Auth", password: PASSWORD });
  cookie = await signIn();
});

afterAll(async () => {
  // Sessions and accounts cascade.
  await admin`DELETE FROM "user" WHERE id = ${userId}`;
  await admin.end();
});

describe("public auth route", () => {
  it("refuses changing the password with a valid session", async () => {
    const response = await call("POST", "/change-password", {
      currentPassword: PASSWORD,
      newPassword: "un autre mot de passe",
    });
    expect(response.status).toBe(404);
    // The password is unchanged: signing in with it still works.
    await expect(signIn()).resolves.toBeTruthy();
  });

  it("refuses editing the account with a valid session", async () => {
    const response = await call("POST", "/update-user", { name: "Zz Renommé" });
    expect(response.status).toBe(404);
    const [row] = await admin`SELECT name FROM "user" WHERE id = ${userId}`;
    expect(row.name).toBe("Zz Routes Auth");
  });

  it("refuses every other built-in endpoint, for each of its methods", async () => {
    const answered: string[] = [];
    // What the HTTP router reads of an endpoint (better-call's `createRouter`); not every option type declares `metadata`.
    const endpoints: readonly RoutedEndpoint[] = Object.values(auth.api);
    const checked = new Set<string>();
    for (const { path, options } of endpoints) {
      if (!path || options.metadata?.SERVER_ONLY || AUTH_HTTP_PATHS.includes(path)) continue;
      checked.add(path);
      // A path parameter (`/reset-password/:token`) gets a sample value.
      const concrete = path.replace(/:[^/]+/g, "x");
      const methods = Array.isArray(options.method) ? options.method : [options.method];
      for (const method of methods) {
        if (method !== "GET" && method !== "POST") continue;
        const body = method === "POST" ? {} : undefined;
        const viaRoute = await call(method, concrete, body);
        if (viaRoute.status !== 404) answered.push(`route ${method} ${concrete} → ${viaRoute.status}`);
        // Without the route's filter, Better Auth itself refuses every path without a parameter.
        if (concrete !== path) continue;
        const direct = await auth.handler(request(method, concrete, body));
        if (direct.status !== 404) answered.push(`disabledPaths ${method} ${concrete} → ${direct.status}`);
      }
    }
    expect(answered).toEqual([]);
    // The loop really swept the endpoints: every listed path is a real one, and was checked.
    const disabled = auth.options.disabledPaths ?? [];
    expect(disabled.length).toBeGreaterThan(20);
    expect(disabled.filter((path) => !checked.has(path))).toEqual([]);
  });

  it("refuses an unknown path, with or without a trailing slash", async () => {
    expect((await call("POST", "/change-password/")).status).toBe(404);
    expect((await call("GET", "/inexistant")).status).toBe(404);
  });

  it("still reads the session over HTTP and server-side, and signs out server-side", async () => {
    cookie = await signIn();
    const response = await call("GET", "/get-session");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } } | null;
    expect(body?.user.id).toBe(userId);

    const headers = new Headers({ cookie, origin });
    expect((await auth.api.getSession({ headers }))?.user.id).toBe(userId);

    await auth.api.signOut({ headers });
    expect(await auth.api.getSession({ headers })).toBeNull();
    const after = await call("GET", "/get-session");
    expect(after.status).toBe(200);
    expect(await after.json()).toBeNull();
  });
});
