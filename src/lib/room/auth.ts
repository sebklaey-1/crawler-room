/**
 * OAuth 2.1 bearer authentication for the Crawler Room MCP server.
 *
 * The authorization server is Crawler Room itself (`src/lib/room/oauth/`), so
 * the whole flow runs on Lovable Cloud with no platform auth hook and no
 * external identity provider. The MCP endpoint stays a *protected resource*
 * (RFC 9728): it never issues, stores or forwards credentials, it only
 * verifies the presented access token and maps it to the pseudonymous
 * identity used by the domain layer.
 *
 * SECURITY
 * - Tokens are verified locally with HMAC-SHA256 against the server-side
 *   secret `ROOM_OAUTH_SIGNING_SECRET`; only `alg: HS256` is accepted, so
 *   algorithm confusion and `alg: none` are impossible.
 * - Beyond the signature the token must be live (`exp`), name *this* issuer,
 *   carry a non-empty `client_id`, name the canonical MCP resource in `aud`
 *   (RFC 8707) and grant the base scopes. There is NO weaker fallback: a
 *   browser session JWT of any kind is rejected, so only tokens minted
 *   through the OAuth 2.1 flow for this resource reach the MCP surface.
 * - Tokens are never logged, never returned to the model and never stored.
 * - The raw account id is never persisted: only
 *   HMAC-SHA256(secret, "auth:" + id) is used as the pseudonymous subject,
 *   and that digest — not the account id — is the token subject.
 */
import { requireSecret } from "./config";
import { hmacSha256Hex } from "./crypto";
import { roomError } from "./errors";
import { BASE_SCOPES, parseScope, SUPPORTED_SCOPES } from "./oauth/catalog";
import { verifyJwt } from "./oauth/jwt";
import type { Db } from "./store";

export interface AuthUser {
  /**
   * Verified `sub` claim — already the pseudonymous subject digest, never a
   * raw account identifier.
   */
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
const SUBJECT_RE = /^[0-9a-f]{64}$/;

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

/**
 * Canonical OAuth issuer: Crawler Room itself. Derived from the canonical
 * resource, so it can never be pointed at a foreign host by a request header.
 */
export function authIssuer(requestOrigin?: string): string {
  return new URL(canonicalResource(requestOrigin)).origin;
}

/** The one and only production origin of Crawler Room. */
export const PRODUCTION_ORIGIN = "https://crawler.today";
/** The one and only production MCP resource identifier. */
export const PRODUCTION_MCP_RESOURCE = `${PRODUCTION_ORIGIN}/mcp`;
/**
 * DEPRECATED compatibility endpoint. The old path stays reachable so existing
 * clients keep working, but it has NO resource identity of its own: every
 * challenge, metadata document and server info emitted there names the
 * canonical resource above.
 */
export const DEPRECATED_MCP_PATH = "/api/public/mcp";

/**
 * Canonical MCP resource identifier.
 *
 * The value never derives from a request header, so a spoofed `Host` or
 * `X-Forwarded-Host` can never point discovery or a challenge at a foreign
 * resource. `ROOM_MCP_RESOURCE` may only ever repeat the exact production
 * value; anything else fails closed. Only the automated test harness may fall
 * back to the request origin.
 */
export function canonicalResource(requestOrigin?: string): string {
  const configured = (process.env["ROOM_MCP_RESOURCE"] ?? "").trim().replace(/\/+$/, "");
  if (configured) {
    if (configured !== PRODUCTION_MCP_RESOURCE) throw roomError("INTERNAL_ERROR");
    return configured;
  }
  if (process.env["NODE_ENV"] === "test" && requestOrigin) {
    return `${requestOrigin.replace(/\/+$/, "")}/mcp`;
  }
  return PRODUCTION_MCP_RESOURCE;
}

/**
 * RFC 9728 metadata URL of the protected resource.
 *
 * The well-known suffix is inserted *between host and resource path*, so a
 * resource with the path `/mcp` is described by
 * `/.well-known/oauth-protected-resource/mcp`. Only that URL is
 * ever advertised in a challenge.
 */
export function resourceMetadataUrl(requestOrigin?: string): string {
  const resource = new URL(canonicalResource(requestOrigin));
  const path = resource.pathname.replace(/\/+$/, "");
  return `${resource.origin}/.well-known/oauth-protected-resource${path}`;
}

/** Compatibility alias served on the root well-known path (same document). */
export const ROOT_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/** Test-only seam: lets the suite inject verified claims without signing. */
type ClaimsVerifier = (token: string) => Promise<Record<string, unknown> | null>;
let testVerifier: ClaimsVerifier | null = null;

export function __setTestClaimsVerifier(verifier: ClaimsVerifier | null): void {
  if (process.env["NODE_ENV"] !== "test") throw roomError("INTERNAL_ERROR");
  testVerifier = verifier;
  tokenCache.clear();
}

async function verifiedClaims(token: string): Promise<Record<string, unknown> | null> {
  if (process.env["NODE_ENV"] === "test" && testVerifier) return testVerifier(token);
  return (await verifyJwt(token)) as Record<string, unknown> | null;
}

/* -------------------------------- validation ------------------------------ */

function claimList(value: unknown): string[] {
  return parseScope(value);
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
  if (!issuer || issuer !== authIssuer(requestOrigin)) throw roomError("INVALID_TOKEN");

  // The subject is the pseudonymous digest minted at consent time — a raw
  // account id or e-mail can never appear here.
  const sub = typeof claims["sub"] === "string" ? claims["sub"] : "";
  if (!SUBJECT_RE.test(sub)) throw roomError("INVALID_TOKEN");

  const exp = typeof claims["exp"] === "number" ? claims["exp"] : 0;
  if (!exp || exp * 1000 <= Date.now()) throw roomError("INVALID_TOKEN");

  // Client binding. Tokens minted through the OAuth 2.1 flow carry `client_id`;
  // anything without it is not an MCP access token and is rejected here.
  const clientId = typeof claims["client_id"] === "string" ? claims["client_id"].trim() : "";
  if (!clientId) throw roomError("INVALID_TOKEN");

  // Resource binding (RFC 8707 / MCP): the canonical resource must be the
  // audience. Any other audience is not a resource and never satisfies this.
  const audiences = claimList(claims["aud"]);
  const boundByAud = audiences.some((aud) => aud.replace(/\/+$/, "") === resource);
  if (!boundByAud) throw roomError("INVALID_TOKEN");

  const scopes = claimList(claims["scope"]);
  for (const required of BASE_SCOPES) {
    if (!scopes.includes(required)) throw roomError("INVALID_TOKEN");
  }

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
    resource_name: "Crawler Room",
    resource_documentation: new URL(resource).origin + "/crawler-room",
  };
}

/**
 * Bearer challenge. The `resource_metadata` URL always comes from the
 * canonical resource — in production `https://crawler.today/...` — and never
 * from the (spoofable) request origin. `requestOrigin` is honoured only by the
 * test harness.
 */
export function challengeHeader(
  requestOrigin?: string,
  error?: "invalid_token" | "insufficient_scope",
  description?: string,
): string {
  const parts = [`Bearer resource_metadata="${resourceMetadataUrl(requestOrigin)}"`];

  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  return parts.join(", ");
}
