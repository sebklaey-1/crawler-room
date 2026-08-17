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

/* --------------------------- profile image ids --------------------------- */

const PROFILE_IMAGE_PREFIX = "pim_";

async function profileImageSignature(roomId: string, kind: string): Promise<string> {
  const secret = requireSecret("MESSAGE_ID_SECRET");
  const digest = await hmacSha256Hex(secret, `profile-image:${roomId}:${kind}`);
  return digest.slice(0, SIGNATURE_LENGTH);
}

/** Opaque, signed reference to the avatar or banner of one personal room. */
export async function encodeProfileImageId(roomId: string, kind: string): Promise<string> {
  const sig = await profileImageSignature(roomId, kind);
  return PROFILE_IMAGE_PREFIX + base64UrlEncode(`${roomId}.${kind}.${sig}`);
}

export async function decodeProfileImageId(
  external: unknown,
): Promise<{ roomId: string; kind: "avatar" | "banner" } | null> {
  if (typeof external !== "string" || !external.startsWith(PROFILE_IMAGE_PREFIX)) return null;
  let decoded: string;
  try {
    decoded = base64UrlDecode(external.slice(PROFILE_IMAGE_PREFIX.length));
  } catch {
    return null;
  }
  const parts = decoded.split(".");
  if (parts.length !== 3) return null;
  const [roomId, kind, sig] = parts as [string, string, string];
  if (!/^[0-9a-f-]{36}$/i.test(roomId)) return null;
  if (kind !== "avatar" && kind !== "banner") return null;
  if (!safeEqual(await profileImageSignature(roomId, kind), sig)) return null;
  return { roomId, kind };
}

export function idKind(external: unknown): "message" | "image" | null {
  if (typeof external !== "string") return null;
  if (external.startsWith(PREFIX)) return "message";
  if (external.startsWith(IMAGE_PREFIX)) return "image";
  return null;
}

/* -------------------------------- room ids -------------------------------- */

const ROOM_PREFIX = "rid_";

async function roomSignature(uuid: string): Promise<string> {
  const secret = requireSecret("MESSAGE_ID_SECRET");
  const digest = await hmacSha256Hex(secret, `room:${uuid}`);
  return digest.slice(0, SIGNATURE_LENGTH);
}

export async function encodeRoomId(uuid: string): Promise<string> {
  return ROOM_PREFIX + base64UrlEncode(`${uuid}.${await roomSignature(uuid)}`);
}

export async function decodeRoomId(external: unknown): Promise<string | null> {
  if (typeof external !== "string" || !external.startsWith(ROOM_PREFIX)) return null;
  let decoded: string;
  try {
    decoded = base64UrlDecode(external.slice(ROOM_PREFIX.length));
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf(".");
  if (separator <= 0) return null;
  const uuid = decoded.slice(0, separator);
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return null;
  if (!safeEqual(await roomSignature(uuid), decoded.slice(separator + 1))) return null;
  return uuid;
}

/* ------------------------------ campaign ids ------------------------------ */

const CAMPAIGN_PREFIX = "cmp_";

async function campaignSignature(uuid: string): Promise<string> {
  const secret = requireSecret("MESSAGE_ID_SECRET");
  const digest = await hmacSha256Hex(secret, `campaign:${uuid}`);
  return digest.slice(0, SIGNATURE_LENGTH);
}

export async function encodeCampaignId(uuid: string): Promise<string> {
  return CAMPAIGN_PREFIX + base64UrlEncode(`${uuid}.${await campaignSignature(uuid)}`);
}

export async function decodeCampaignId(external: unknown): Promise<string | null> {
  if (typeof external !== "string" || !external.startsWith(CAMPAIGN_PREFIX)) return null;
  let decoded: string;
  try {
    decoded = base64UrlDecode(external.slice(CAMPAIGN_PREFIX.length));
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf(".");
  if (separator <= 0) return null;
  const uuid = decoded.slice(0, separator);
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return null;
  if (!safeEqual(await campaignSignature(uuid), decoded.slice(separator + 1))) return null;
  return uuid;
}

/* ---------------------------- organization ids ---------------------------- */

const ORG_PREFIX = "oid_";

async function orgSignature(uuid: string): Promise<string> {
  const secret = requireSecret("MESSAGE_ID_SECRET");
  const digest = await hmacSha256Hex(secret, `organization:${uuid}`);
  return digest.slice(0, SIGNATURE_LENGTH);
}

/** Opaque, signed organization reference. Raw account/owner UUIDs never leave the server. */
export async function encodeOrgId(uuid: string): Promise<string> {
  return ORG_PREFIX + base64UrlEncode(`${uuid}.${await orgSignature(uuid)}`);
}

export async function decodeOrgId(external: unknown): Promise<string | null> {
  if (typeof external !== "string" || !external.startsWith(ORG_PREFIX)) return null;
  let decoded: string;
  try {
    decoded = base64UrlDecode(external.slice(ORG_PREFIX.length));
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf(".");
  if (separator <= 0) return null;
  const uuid = decoded.slice(0, separator);
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return null;
  if (!safeEqual(await orgSignature(uuid), decoded.slice(separator + 1))) return null;
  return uuid;
}
