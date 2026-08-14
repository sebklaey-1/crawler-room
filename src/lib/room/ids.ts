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

/* ------------------------------- image ids ------------------------------- */

const IMAGE_PREFIX = "img_";

async function imageSignature(internalId: number | string): Promise<string> {
  const secret = requireSecret("MESSAGE_ID_SECRET");
  const digest = await hmacSha256Hex(secret, `image:${internalId}`);
  return digest.slice(0, SIGNATURE_LENGTH);
}

export async function encodeImageId(internalId: number | string): Promise<string> {
  const sig = await imageSignature(internalId);
  return IMAGE_PREFIX + base64UrlEncode(`${internalId}.${sig}`);
}

export async function decodeImageId(external: unknown): Promise<number | null> {
  if (typeof external !== "string" || !external.startsWith(IMAGE_PREFIX)) return null;
  let decoded: string;
  try {
    decoded = base64UrlDecode(external.slice(IMAGE_PREFIX.length));
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf(".");
  if (separator <= 0) return null;
  const rawId = decoded.slice(0, separator);
  const sig = decoded.slice(separator + 1);
  if (!/^\d+$/.test(rawId)) return null;
  if (!safeEqual(await imageSignature(rawId), sig)) return null;
  return Number.parseInt(rawId, 10);
}

export function idKind(external: unknown): "message" | "image" | null {
  if (typeof external !== "string") return null;
  if (external.startsWith(PREFIX)) return "message";
  if (external.startsWith(IMAGE_PREFIX)) return "image";
  return null;
}
