/**
 * OAuth 2.1 bearer authentication for the @room MCP server.
 *
 * The authorization server is the Supabase Auth instance of this project.
 * The MCP endpoint is a *protected resource* (RFC 9728): it never issues,
 * stores or forwards credentials, it only verifies the presented access token
 * and maps it to the pseudonymous identity used by the domain layer.
 *
 * SECURITY
 * - Tokens are verified with the official Supabase client (`auth.getClaims`),
 *   which validates the ES256 signature against the project's JWKS. No hand
 *   rolled or unverified JWT parsing decides authorisation.
 * - Beyond the signature every token must be *bound to this resource*: it needs
 *   a non-empty `client_id` (so ordinary web sessions are never accepted), an
 *   `aud` and a `room_resource` claim equal to the canonical MCP resource, and
 *   `room_scopes` containing at least `openid` and `profile`. Those claims are
 *   added by the `custom_access_token_hook` database function.
 * - Tokens are never logged, never returned to the model and never stored.
 * - The raw auth user id is never persisted: only
 *   HMAC-SHA256(secret, "auth:" + sub) is used as the pseudonymous subject.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireSecret } from "./config";
import { hmacSha256Hex } from "./crypto";
import { roomError } from "./errors";
import type { Db } from "./store";

export interface AuthUser {
  /** Verified `sub` claim. Never leaves this module in raw form. */
  userId: string;
  issuer: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
}

interface CacheEntry {
  user: AuthUser;
  expires: number;
}

/** Short-lived positive cache so a burst of tool calls does not re-verify. */
const tokenCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const MAX_TOKEN_LENGTH = 8192;
const VERIFY_TIMEOUT_MS = 5_000;
const REQUIRED_SCOPES = ["openid", "profile"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = (match[1] ?? "").trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

/* ------------------------------ configuration ----------------------------- */

function supabaseBase(): string {
  return (process.env["SUPABASE_URL"] ?? "").replace(/\/+$/, "");
}

/** Canonical OAuth issuer of this project's authorization server. */
export function authIssuer(): string {
  const base = supabaseBase();
  return base ? `${base}/auth/v1` : "";
}

/**
 * Canonical MCP resource identifier.
 *
 * Production MUST configure `ROOM_MCP_RESOURCE` with the exact https URL; the
 * value never derives from a request header, so a spoofed `Host` can never
 * point the protected-resource metadata at a foreign resource. Only the
 * automated test harness may fall back to the request origin.
 */
export function canonicalResource(requestOrigin?: string): string {
  const configured = (process.env["ROOM_MCP_RESOURCE"] ?? "").trim().replace(/\/+$/, "");
  if (configured) {
    if (!/^https:\/\//i.test(configured)) throw roomError("INTERNAL_ERROR");
    return configured;
  }
  if (process.env["NODE_ENV"] === "test" && requestOrigin) {
    return `${requestOrigin.replace(/\/+$/, "")}/api/public/mcp`;
  }
  throw roomError("INTERNAL_ERROR");
}

let verifyClient: SupabaseClient | null = null;

/** Server-side, non-persisting Supabase client used only for verification. */
function authClient(): SupabaseClient {
  if (verifyClient) return verifyClient;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
  if (!url || !key) throw roomError("INTERNAL_ERROR");
  verifyClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return verifyClient;
}

/** Test-only seam: lets the suite inject verified claims without a network. */
type ClaimsVerifier = (token: string) => Promise<Record<string, unknown> | null>;
let testVerifier: ClaimsVerifier | null = null;

export function __setTestClaimsVerifier(verifier: ClaimsVerifier | null): void {
  if (process.env["NODE_ENV"] !== "test") throw roomError("INTERNAL_ERROR");
  testVerifier = verifier;
  tokenCache.clear();
}

async function verifiedClaims(token: string): Promise<Record<string, unknown> | null> {
  if (process.env["NODE_ENV"] === "test" && testVerifier) return testVerifier(token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const { data, error } = await authClient().auth.getClaims(token);
    if (error) throw roomError("INVALID_TOKEN");
    const claims = (data as { claims?: Record<string, unknown> } | null)?.claims;
    return claims ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------- validation ------------------------------ */

function claimList(value: unknown): string[] {
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  return [];
}

async function cacheKey(token: string): Promise<string> {
  // Never key the cache with the raw token.
  return hmacSha256Hex(requireSecret("SUBJECT_HASH_SECRET"), `token:${token}`);
}

/**
 * Verifies an MCP access token and its binding to this resource.
 * Throws INVALID_TOKEN for anything that is not a live, resource-bound token.
 */
export async function verifyAccessToken(token: string, requestOrigin?: string): Promise<AuthUser> {
  const resource = canonicalResource(requestOrigin);
  const key = await cacheKey(token);
  const cached = tokenCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.user;

  let claims: Record<string, unknown> | null;
  try {
    claims = await verifiedClaims(token);
  } catch (error) {
    if ((error as { code?: string })?.code === "INVALID_TOKEN") throw error;
    throw roomError("INTERNAL_ERROR");
  }
  if (!claims) throw roomError("INVALID_TOKEN");

  const issuer = typeof claims["iss"] === "string" ? claims["iss"] : "";
  if (!issuer || issuer !== authIssuer()) throw roomError("INVALID_TOKEN");

  const sub = typeof claims["sub"] === "string" ? claims["sub"] : "";
  if (!UUID_RE.test(sub)) throw roomError("INVALID_TOKEN");

  const exp = typeof claims["exp"] === "number" ? claims["exp"] : 0;
  if (!exp || exp * 1000 <= Date.now()) throw roomError("INVALID_TOKEN");

  const clientId = typeof claims["client_id"] === "string" ? claims["client_id"].trim() : "";
  if (!clientId) throw roomError("INVALID_TOKEN");

  if (!claimList(claims["aud"]).includes(resource)) throw roomError("INVALID_TOKEN");
  if (claims["room_resource"] !== resource) throw roomError("INVALID_TOKEN");

  const scopes = claimList(claims["room_scopes"]);
  if (!REQUIRED_SCOPES.every((scope) => scopes.includes(scope))) throw roomError("INVALID_TOKEN");

  const user: AuthUser = { userId: sub, issuer, clientId, scopes, expiresAt: exp };

  const ttl = Math.min(CACHE_TTL_MS, Math.max(0, exp * 1000 - Date.now()));
  tokenCache.set(key, { user, expires: Date.now() + ttl });
  if (tokenCache.size > 500) {
    for (const [entryKey, entry] of tokenCache)
      if (entry.expires <= Date.now()) tokenCache.delete(entryKey);
  }
  return user;
}

/* --------------------------------- identity -------------------------------- */

/** Keyed, non-reversible digest of the auth account. Nothing else is stored. */
export async function authUserHash(userId: string): Promise<string> {
  return hmacSha256Hex(requireSecret("SUBJECT_HASH_SECRET"), `auth:${userId}`);
}

/** Stable pseudonym of an authenticated account (identical to its hash). */
export async function authSubjectHash(userId: string): Promise<string> {
  return authUserHash(userId);
}

/**
 * Maps a verified account onto the pseudonymous subject used everywhere else.
 *
 * There is deliberately NO automatic takeover of a legacy `openai/subject`
 * identity: an unauthenticated MCP `_meta` value is not proof of ownership.
 * Legacy rows stay untouched; linking them is a controlled manual migration.
 */
export async function resolveAuthSubject(db: Db, userId: string): Promise<string> {
  const hash = await authUserHash(userId);

  const { data: existing, error: readError } = await db
    .from("anonymous_identities")
    .select("subject_hash")
    .eq("auth_user_hash", hash)
    .maybeSingle();
  if (readError) throw roomError("INTERNAL_ERROR");
  if ((existing as { subject_hash?: string } | null)?.subject_hash) {
    return (existing as { subject_hash: string }).subject_hash;
  }

  const now = new Date().toISOString();
  const { error: writeError } = await db
    .from("anonymous_identities")
    .upsert(
      { subject_hash: hash, auth_user_hash: hash, last_seen_at: now },
      { onConflict: "subject_hash" },
    );

  if (writeError) {
    // Unique race on auth_user_hash: re-read instead of creating a second identity.
    const { data: raced, error: raceError } = await db
      .from("anonymous_identities")
      .select("subject_hash")
      .eq("auth_user_hash", hash)
      .maybeSingle();
    if (raceError || !(raced as { subject_hash?: string } | null)?.subject_hash) {
      throw roomError("INTERNAL_ERROR");
    }
    return (raced as { subject_hash: string }).subject_hash;
  }
  return hash;
}

/* -------------------------------- discovery -------------------------------- */

/** Discovery document for RFC 9728 (OAuth 2.0 Protected Resource Metadata). */
export function protectedResourceMetadata(requestOrigin?: string) {
  const issuer = authIssuer();
  const resource = canonicalResource(requestOrigin);
  return {
    resource,
    authorization_servers: issuer ? [issuer] : [],
    bearer_methods_supported: ["header"],
    scopes_supported: [...REQUIRED_SCOPES],
    resource_name: "@room",
    resource_documentation: new URL(resource).origin + "/",
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
