/**
 * Opaque, non-enumerable external message IDs.
 * Format: `mid_<base64url(<internalId>.<hmac-prefix>)>`
 */
import { requireSecret } from "./config";
import { base64UrlDecode, base64UrlEncode, hmacSha256Hex, safeEqual } from "./crypto";

const PREFIX = "mid_";
const SIGNATURE_LENGTH = 16;

async function signature(internalId: number | string): Promise<string> {
  const secret = requireSecret("MESSAGE_ID_SECRET");
  const digest = await hmacSha256Hex(secret, `message:${internalId}`);
  return digest.slice(0, SIGNATURE_LENGTH);
}

export async function encodeMessageId(internalId: number | string): Promise<string> {
  const sig = await signature(internalId);
  return PREFIX + base64UrlEncode(`${internalId}.${sig}`);
}

/** Returns the internal id, or null when the value is malformed or forged. */
export async function decodeMessageId(external: unknown): Promise<number | null> {
  if (typeof external !== "string" || !external.startsWith(PREFIX)) return null;
  let decoded: string;
  try {
    decoded = base64UrlDecode(external.slice(PREFIX.length));
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf(".");
  if (separator <= 0) return null;
  const rawId = decoded.slice(0, separator);
  const sig = decoded.slice(separator + 1);
  if (!/^\d+$/.test(rawId)) return null;
  const expected = await signature(rawId);
  if (!safeEqual(expected, sig)) return null;
  return Number.parseInt(rawId, 10);
}
