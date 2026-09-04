const SESSION_COOKIE = "app_session";
const SESSION_TTL_S = 60 * 60 * 24 * 7; // 7 days
const TXN_COOKIE = "oidc_txn";

export function loginEnabled(env: any): boolean {
  return Boolean(
    env.COMMONS_OIDC_ISSUER && env.COMMONS_OIDC_CLIENT_ID && env.COMMONS_OIDC_CLIENT_SECRET,
  );
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256b64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return b64url(new Uint8Array(digest));
}

function appBase(request: Request): string {
  return request.headers.get("X-Vibe-Base-Path") ?? "";
}

function cookie(name: string, value: string, maxAgeS: number, path = "/"): string {
  return `${name}=${value}; Max-Age=${maxAgeS}; Path=${path}; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request: Request, name: string): string | null {
  const match = (request.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? match[1] : null;
}

export function ensureAuthTables(sql: any): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS users (
    sub TEXT PRIMARY KEY, name TEXT, email TEXT, x_handle TEXT, github_handle TEXT,
    created_at INTEGER NOT NULL)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, sub TEXT NOT NULL, expires_at INTEGER NOT NULL)`);
}

export async function handleLogin(request: Request, env: any): Promise<Response> {
  if (!loginEnabled(env)) return new Response("Sign-in is not available", { status: 503 });
  const url = new URL(request.url);
  const base = appBase(request);
  const next = url.searchParams.get("next") ?? "/";
  const state = randomToken();
  const verifier = randomToken();
  const authorize = new URL(`${env.COMMONS_OIDC_ISSUER}/oidc/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: env.COMMONS_OIDC_CLIENT_ID,
    redirect_uri: `${url.origin}${base}/auth/callback`,
    scope: "openid profile",
    state,
    code_challenge: await sha256b64url(verifier),
    code_challenge_method: "S256",
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Set-Cookie": cookie(TXN_COOKIE, `${state}.${verifier}.${encodeURIComponent(next)}`, 600, `${base}/`),
    },
  });
}

export async function handleCallback(request: Request, env: any, sql: any): Promise<Response> {
  const url = new URL(request.url);
  const txn = readCookie(request, TXN_COOKIE);
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") === "access_denied") {
    return Response.redirect(`${url.origin}${appBase(request)}/`, 302);
  }
  if (!txn || !code) return new Response("Sign-in expired, try again", { status: 400 });
  const [state, verifier, nextEncoded] = txn.split(".");
  if (url.searchParams.get("state") !== state) {
    return new Response("Sign-in state mismatch, try again", { status: 400 });
  }

  const tokenResponse = await fetch(`${env.COMMONS_OIDC_ISSUER}/oidc/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${url.origin}${appBase(request)}/auth/callback`,
      code_verifier: verifier,
      client_id: env.COMMONS_OIDC_CLIENT_ID,
      client_secret: env.COMMONS_OIDC_CLIENT_SECRET,
    }),
  });
  if (!tokenResponse.ok) return new Response("Sign-in failed, try again", { status: 502 });
  const { id_token } = (await tokenResponse.json()) as { id_token: string };

  const claims = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
        (c) => c.charCodeAt(0)),
    ),
  ) as { iss: string; aud: string; exp: number; sub: string; name?: string };
  if (
    claims.iss !== env.COMMONS_OIDC_ISSUER ||
    claims.aud !== env.COMMONS_OIDC_CLIENT_ID ||
    claims.exp * 1000 < Date.now()
  ) {
    return new Response("Sign-in failed, try again", { status: 502 });
  }

  ensureAuthTables(sql);
  sql.exec(
    `INSERT INTO users (sub, name, created_at) VALUES (?, ?, ?)
     ON CONFLICT(sub) DO UPDATE SET name=excluded.name`,
    claims.sub, claims.name ?? null, Date.now(),
  );
  const sessionId = randomToken();
  sql.exec("INSERT INTO sessions (id, sub, expires_at) VALUES (?, ?, ?)",
    sessionId, claims.sub, Date.now() + SESSION_TTL_S * 1000);

  const base = appBase(request);
  const next = decodeURIComponent(nextEncoded ?? "%2F");
  const headers = new Headers({ Location: next.startsWith("/") ? next : "/" });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, sessionId, SESSION_TTL_S, `${base}/`));
  headers.append("Set-Cookie", cookie(TXN_COOKIE, "", 0, `${base}/`));
  return new Response(null, { status: 302, headers });
}

export function handleLogout(request: Request, sql: any): Response {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (sessionId) sql.exec("DELETE FROM sessions WHERE id = ?", sessionId);
  const base = appBase(request);
  return new Response(null, {
    status: 302,
    headers: { Location: `${base}/`, "Set-Cookie": cookie(SESSION_COOKIE, "", 0, `${base}/`) },
  });
}

export function getSessionUser(request: Request, sql: any) {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  ensureAuthTables(sql);
  const rows = sql.exec(
    `SELECT u.sub, u.name, u.created_at
     FROM sessions s JOIN users u ON u.sub = s.sub
     WHERE s.id = ? AND s.expires_at > ?`,
    sessionId, Date.now(),
  ).toArray();
  return rows.length ? (rows[0] as any) : null;
}
