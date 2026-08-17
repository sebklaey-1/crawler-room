/**
 * Pseudonymous identity of the calling person.
 *
 * Crawler Room has no accounts, no sign-in and no profiles. Every caller is
 * identified only by the pseudonymous subject the MCP client provides
 * (`openai/subject`), hashed with a server secret. From that hash a stable
 * pseudonym (alias) is derived.
 *
 * SECURITY:
 * - Identity is NEVER a tool input; it comes from the transport layer only.
 * - Raw subjects are never stored; only HMAC-SHA256 digests.
 */
import { requireSecret } from "./config";
import { hmacSha256Hex } from "./crypto";

export type McpMeta = Record<string, unknown> | undefined;

export interface Identity {
  subjectHash: string;
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

/** Strips every server-controlled `room/*` key from client supplied `_meta`. */
export function sanitizeClientMeta(meta: McpMeta): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (key.startsWith("room/")) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Identity of the caller. Never throws: without a subject the session is used,
 * and without both a per-request pseudonym is created.
 */
export async function resolveIdentity(meta: McpMeta): Promise<Identity> {
  const secret = requireSecret("SUBJECT_HASH_SECRET");
  const session = readMetaString(meta, "openai/session");
  const subject = readSubject(meta) ?? (session ? `session:${session}` : null);
  const seed = subject ?? `ephemeral:${crypto.randomUUID()}`;

  return {
    subjectHash: await hmacSha256Hex(secret, seed),
    sessionHash: session ? await hmacSha256Hex(secret, session) : null,
    locale: readMetaString(meta, "openai/locale"),
  };
}
