/**
 * Short-lived, HMAC-signed capability tokens.
 *
 * Used for the private upload target and for the moderation review step.
 * A token binds a purpose, an image id and the pseudonymous subject hash, so
 * it cannot be replayed for another image, another person or another purpose.
 */
import { requireSecret } from "./config";
import { base64UrlDecode, base64UrlEncode, hmacSha256Hex, safeEqual } from "./crypto";

export type TokenPurpose = "upload" | "review" | "profile_upload";

interface Payload {
  p: TokenPurpose;
  i: number;
  s: string;
  e: number;
  n: string;
  /** Optional extra binding: personal room id and profile image kind. */
  r?: string;
  k?: string;
}

export interface TokenClaims {
  purpose: TokenPurpose;
  imageId: number;
  subjectHash: string;
  nonce: string;
  roomId?: string;
  kind?: string;
}


async function sign(body: string): Promise<string> {
  return (await hmacSha256Hex(requireSecret("MESSAGE_ID_SECRET"), `token:${body}`)).slice(0, 32);
}

export async function issueToken(
  purpose: TokenPurpose,
  imageId: number,
  subjectHash: string,
  ttlSeconds: number,
  nonce: string,
  extra?: { roomId?: string; kind?: string },
): Promise<string> {
  const payload: Payload = {
    p: purpose,
    i: imageId,
    s: subjectHash.slice(0, 32),
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
    n: nonce,
    ...(extra?.roomId ? { r: extra.roomId } : {}),
    ...(extra?.kind ? { k: extra.kind } : {}),
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${await sign(body)}`;
}


export async function verifyToken(
  token: unknown,
  purpose: TokenPurpose,
): Promise<TokenClaims | null> {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const separator = token.lastIndexOf(".");
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(await sign(body), signature)) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(base64UrlDecode(body)) as Payload;
  } catch {
    return null;
  }
  if (payload.p !== purpose) return null;
  if (typeof payload.e !== "number" || payload.e * 1000 < Date.now()) return null;
  if (typeof payload.i !== "number" || typeof payload.s !== "string") return null;

  return { purpose: payload.p, imageId: payload.i, subjectHash: payload.s, nonce: payload.n };
}

export function subjectFingerprint(subjectHash: string): string {
  return subjectHash.slice(0, 32);
}
