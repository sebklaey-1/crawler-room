/**
 * OAuth 2.1 bearer authentication for the @room MCP server.
 *
 * The authorization server is the Supabase Auth instance of this project.
 * The MCP endpoint is a *protected resource*: it never issues, stores or
 * forwards credentials, it only validates the presented access token and maps
 * it to the pseudonymous identity used by the domain layer.
 *
 * SECURITY
 * - Tokens are validated against Supabase (`/auth/v1/user`); a token that this
 *   project's auth server does not recognise is rejected.
 * - Tokens are never logged, never returned to the model and never stored.
 * - The raw auth user id is never persisted in domain tables; only
 *   HMAC-SHA256(secret, "auth:" + userId) is used as the pseudonymous subject.
 */
import { requireSecret } from "./config";
import { hmacSha256Hex } from "./crypto";
import { roomError } from "./errors";
import type { Db } from "./store";

export interface AuthUser {
  userId: string;
  issuer: string | null;
  expiresAt: number | null;
}

interface CacheEntry {
  user: AuthUser;
  expires: number;
}

/** Short-lived positive cache so a burst of tool calls does not re-introspect. */
const tokenCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const MAX_TOKEN_LENGTH = 8192;

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = (match[1] ?? "").trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  if (typeof atob === "function") return atob(withPadding);
  return Buffer.from(withPadding, "base64").toString("binary");
}

/** Unverified read of the payload — used only for cheap pre-checks. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1] ?? "")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function cacheKey(token: string): Promise<string> {
  // Never key the cache with the raw token.
  return hmacSha256Hex(requireSecret("SUBJECT_HASH_SECRET"), `token:${token}`);
}

/**
 * Validates the access token with the project's Supabase auth server.
 * Throws INVALID_TOKEN for anything that is not a live, non-expired token.
 */
export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const key = await cacheKey(token);
  const cached = tokenCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.user;

  const payload = decodeJwtPayload(token);
  const exp = typeof payload?.["exp"] === "number" ? (payload["exp"] as number) : null;
  if (exp !== null && exp * 1000 <= Date.now()) throw roomError("INVALID_TOKEN");

  const baseUrl = process.env["SUPABASE_URL"];
  const apiKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
  if (!baseUrl || !apiKey) throw roomError("INTERNAL_ERROR");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: apiKey },
    });
  } catch {
    throw roomError("INTERNAL_ERROR");
  }

  if (response.status === 401 || response.status === 403) throw roomError("INVALID_TOKEN");
  if (!response.ok) throw roomError("INTERNAL_ERROR");

  const body = (await response.json()) as { id?: string };
  if (!body?.id) throw roomError("INVALID_TOKEN");

  const user: AuthUser = {
    userId: body.id,
    issuer: typeof payload?.["iss"] === "string" ? (payload["iss"] as string) : null,
    expiresAt: exp,
  };

  const ttl = exp ? Math.min(CACHE_TTL_MS, Math.max(0, exp * 1000 - Date.now())) : CACHE_TTL_MS;
  tokenCache.set(key, { user, expires: Date.now() + ttl });
  if (tokenCache.size > 500) {
    for (const [entryKey, entry] of tokenCache)
      if (entry.expires <= Date.now()) tokenCache.delete(entryKey);
  }
  return user;
}

/** Stable pseudonym for an authenticated account when no legacy identity exists. */
export async function authSubjectHash(userId: string): Promise<string> {
  return hmacSha256Hex(requireSecret("SUBJECT_HASH_SECRET"), `auth:${userId}`);
}

/**
 * Maps an authenticated user onto the pseudonymous subject used everywhere else.
 * A previously anonymous identity (from `openai/subject`) is claimed once, so
 * existing rooms, profiles, followers and messages stay with the same person.
 */
export async function resolveAuthSubject(
  db: Db,
  userId: string,
  legacySubjectHash: string | null,
): Promise<string> {
  const { data: linked } = await db
    .from("anonymous_identities")
    .select("subject_hash")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if ((linked as any)?.subject_hash) return (linked as any).subject_hash as string;

  if (legacySubjectHash) {
    const { data: claimed } = await db
      .from("anonymous_identities")
      .update({ auth_user_id: userId, last_seen_at: new Date().toISOString() })
      .eq("subject_hash", legacySubjectHash)
      .is("auth_user_id", null)
      .select("subject_hash");
    const row = ((claimed ?? []) as any[])[0];
    if (row?.subject_hash) return row.subject_hash as string;
  }

  const hash = await authSubjectHash(userId);
  await db
    .from("anonymous_identities")
    .upsert(
      { subject_hash: hash, auth_user_id: userId, last_seen_at: new Date().toISOString() },
      { onConflict: "subject_hash" },
    );
  return hash;
}

/** Discovery document for RFC 9728 (OAuth 2.0 Protected Resource Metadata). */
export function protectedResourceMetadata(origin: string) {
  const base = (process.env["SUPABASE_URL"] ?? "").replace(/\/$/, "");
  // Canonical OAuth issuer of the project's auth server (OpenID discovery).
  const issuer = base ? `${base}/auth/v1` : "";
  return {
    resource: `${origin}/api/public/mcp`,
    authorization_servers: issuer ? [issuer] : [],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "email", "profile"],
    resource_name: "@room",
    resource_documentation: `${origin}/`,
  };
}

export function challengeHeader(
  origin: string,
  error?: "invalid_token" | "insufficient_scope",
  description?: string,
): string {
  const metadata = `${origin}/.well-known/oauth-protected-resource`;
  const parts = [`Bearer resource_metadata="${metadata}"`];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  return parts.join(", ");
}
