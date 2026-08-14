/**
 * Pseudonymous identity derived from MCP request metadata.
 *
 * SECURITY:
 * - `openai/subject` is NEVER accepted as a tool input from the model.
 * - The raw subject value is never stored; only HMAC-SHA256(secret, subject).
 * - Missing subject => IDENTITY_UNAVAILABLE (never a random fallback identity).
 */
import { requireSecret } from "./config";
import { hmacSha256Hex } from "./crypto";
import { roomError } from "./errors";

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

export async function resolveIdentity(meta: McpMeta): Promise<Identity> {
  const subject = readSubject(meta);
  if (!subject) throw roomError("IDENTITY_UNAVAILABLE");

  const secret = requireSecret("SUBJECT_HASH_SECRET");
  const subjectHash = await hmacSha256Hex(secret, subject);

  const session = readMetaString(meta, "openai/session");
  const sessionHash = session ? await hmacSha256Hex(secret, session) : null;

  return {
    subjectHash,
    sessionHash,
    locale: readMetaString(meta, "openai/locale"),
  };
}
