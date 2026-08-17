/**
 * Minimal, dependency-free JWT (HS256) signing and verification.
 *
 * SECURITY
 * - Only `HS256` is accepted. The `alg` header is compared against the one
 *   algorithm this server issues, so an `alg: none` or `alg: RS256` token can
 *   never bypass verification (algorithm-confusion is impossible here).
 * - The signature is compared in constant time over the exact signing input.
 * - The signing key never leaves the server; it lives in the platform secret
 *   `ROOM_OAUTH_SIGNING_SECRET` and is read lazily inside request handlers.
 */
import { requireSecret } from "../config";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface JwtClaims extends Record<string, unknown> {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  jti: string;
  client_id: string;
  scope: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeSegment(value: unknown): string {
  return bytesToBase64Url(encoder.encode(JSON.stringify(value)));
}

async function signingKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(requireSecret("ROOM_OAUTH_SIGNING_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const HEADER = { alg: "HS256", typ: "JWT", kid: "room-oauth-1" } as const;

export async function signJwt(claims: JwtClaims): Promise<string> {
  const input = `${encodeSegment(HEADER)}.${encodeSegment(claims)}`;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(input));
  return `${input}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/** Returns the claims of a structurally valid, correctly signed token, else null. */
export async function verifyJwt(token: string): Promise<JwtClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  let header: { alg?: unknown; typ?: unknown };
  let claims: JwtClaims;
  try {
    header = JSON.parse(decoder.decode(base64UrlToBytes(headerPart))) as { alg?: unknown };
    claims = JSON.parse(decoder.decode(base64UrlToBytes(payloadPart))) as JwtClaims;
  } catch {
    return null;
  }
  // Exactly one accepted algorithm — no negotiation, no `none`.
  if (header.alg !== "HS256") return null;
  if (!claims || typeof claims !== "object") return null;

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      base64UrlToBytes(signaturePart) as unknown as ArrayBufferView,
      encoder.encode(`${headerPart}.${payloadPart}`),
    );
  } catch {
    return null;
  }
  return ok ? claims : null;
}
