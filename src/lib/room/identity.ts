/**
 * Pseudonymous identity of the calling person.
 *
 * SECURITY:
 * - Identity is NEVER a tool input; it comes from the transport layer only.
 * - Authenticated calls carry a server-injected `room/auth` entry in `_meta`
 *   that the MCP transport builds from a validated OAuth bearer token. Any
 *   `room/*` key sent by a client is stripped before the handler sees it.
 * - `openai/subject` alone never authorises anything. It is only used to
 *   migrate an existing anonymous identity onto the authenticated account.
 * - Raw subjects and user ids are never stored; only HMAC-SHA256 digests.
 */
import { requireSecret } from "./config";
import { hmacSha256Hex } from "./crypto";
import { roomError } from "./errors";

export type McpMeta = Record<string, unknown> | undefined;

/** Key of the server-injected authentication context inside `_meta`. */
export const AUTH_META_KEY = "room/auth";

export interface AuthMeta {
  userId: string;
  subjectHash: string;
}

export interface Identity {
  subjectHash: string;
  userId: string;
  sessionHash: string | null;
  locale: string | null;
}

function readMetaString(meta: McpMeta, key: string): string | null {
  if (!meta) return null;
  const value = meta[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readSubject(meta: McpMeta): string | null {
  return readMetaString(meta, "openai/subject");
}

/** HMAC of the legacy anonymous subject, used only for one-time account linking. */
export async function legacySubjectHash(meta: McpMeta): Promise<string | null> {
  const subject = readSubject(meta);
  if (!subject) return null;
  return hmacSha256Hex(requireSecret("SUBJECT_HASH_SECRET"), subject);
}

export function readAuthMeta(meta: McpMeta): AuthMeta | null {
  const value = meta?.[AUTH_META_KEY];
  if (!value || typeof value !== "object") return null;
  const { userId, subjectHash } = value as Partial<AuthMeta>;
  if (typeof userId !== "string" || typeof subjectHash !== "string") return null;
  if (!userId || !subjectHash) return null;
  return { userId, subjectHash };
}

/** Strips every server-controlled `room/*` key from client supplied `_meta`. */
export function sanitizeClientMeta(meta: McpMeta): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (key.startsWith("room/")) continue;
    out[key] = value;
  }
  return out;
}

/** Identity of an authenticated caller. Throws AUTH_REQUIRED when signed out. */
export async function resolveIdentity(meta: McpMeta): Promise<Identity> {
  const auth = readAuthMeta(meta);
  if (!auth) throw roomError("AUTH_REQUIRED");

  const secret = requireSecret("SUBJECT_HASH_SECRET");
  const session = readMetaString(meta, "openai/session");

  return {
    subjectHash: auth.subjectHash,
    userId: auth.userId,
    sessionHash: session ? await hmacSha256Hex(secret, session) : null,
    locale: readMetaString(meta, "openai/locale"),
  };
}

/** True when the caller presented a valid access token. */
export function isAuthenticated(meta: McpMeta): boolean {
  return readAuthMeta(meta) !== null;
}
