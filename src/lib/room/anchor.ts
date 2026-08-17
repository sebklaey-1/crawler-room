/**
 * Durable pseudonymous identity anchor.
 *
 * ROOT CAUSE this module fixes: the consent screen is accountless and used to
 * derive the token subject from a *browser-local anonymous session*. Whenever
 * that session was recycled (new browser, cleared storage, expired anonymous
 * user) the next connection produced a brand new subject digest, so the person
 * silently lost their profile, handle and personal room ("Satoshi Nakamoto"
 * reverting to the freshly seeded "Clever Owl").
 *
 * The anchor binds the browser to one stable pseudonymous subject:
 * - a high-entropy random token lives in an httpOnly, Secure, SameSite=Lax
 *   cookie with a long max-age; it is never readable by scripts and never
 *   leaves the origin,
 * - the database stores only its keyed HMAC digest plus the subject digest —
 *   no raw token, no raw account id, no `openai/subject`,
 * - once an anchor exists it always wins over the ephemeral browser session,
 *   so the subject can never silently change,
 * - a missing/unknown anchor never invents an identity on its own: the caller
 *   must supply a verified session subject, otherwise the flow fails closed.
 */
import { hmacSha256Hex, randomId } from "./crypto";
import { getDb, type Db } from "./store";

import { requireSecret } from "./config";

export const ANCHOR_COOKIE = "cr_anchor";
/** 400 days — the maximum a browser will retain a cookie (RFC 6265bis). */
export const ANCHOR_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const TOKEN_RE = /^[0-9a-f]{64}$/;

/** Parses one cookie value out of a raw `Cookie` header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    return value ? value : null;
  }
  return null;
}

export function anchorCookie(token: string): string {
  return [
    `${ANCHOR_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${ANCHOR_MAX_AGE_SECONDS}`,
  ].join("; ");
}

export function newAnchorToken(): string {
  return randomId(32);
}

async function anchorHash(token: string): Promise<string> {
  return hmacSha256Hex(requireSecret("SUBJECT_HASH_SECRET"), `anchor:${token}`);
}

/** Subject digest bound to this anchor token, or null when unknown. */
export async function subjectForAnchor(token: string | null, db?: Db): Promise<string | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const database = db ?? (await getDb());
  const hash = await anchorHash(token);
  const { data, error } = await database
    .from("identity_anchors")
    .select("subject_hash")
    .eq("anchor_hash", hash)
    .maybeSingle();
  if (error || !data) return null;
  await database
    .from("identity_anchors")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("anchor_hash", hash);
  const subject = (data as { subject_hash?: unknown }).subject_hash;
  return typeof subject === "string" && subject ? subject : null;
}

/**
 * Binds a fresh anchor token to an already verified subject digest. Idempotent
 * per token; concurrent binds collapse onto the first stored row, so a retry
 * can never split one person into two identities.
 */
export async function bindAnchor(token: string, subjectHash: string, db?: Db): Promise<string> {
  if (!TOKEN_RE.test(token) || !subjectHash) throw new Error("INVALID_ANCHOR");
  const database = db ?? (await getDb());
  const hash = await anchorHash(token);
  await database
    .from("identity_anchors")
    .upsert({ anchor_hash: hash, subject_hash: subjectHash }, { onConflict: "anchor_hash" });
  const { data } = await database
    .from("identity_anchors")
    .select("subject_hash")
    .eq("anchor_hash", hash)
    .maybeSingle();
  const stored = (data as { subject_hash?: unknown } | null)?.subject_hash;
  return typeof stored === "string" && stored ? stored : subjectHash;
}

export interface AnchoredSubject {
  subjectHash: string;
  /** Set-Cookie value when a new anchor was issued, else null. */
  setCookie: string | null;
}

/**
 * Resolves the stable subject for a consent request.
 *
 * `sessionSubject` is the digest of the verified browser session. It is only
 * consulted when no anchor exists yet; afterwards the anchor is authoritative,
 * which is what makes handle and profile changes survive new sessions.
 */
export async function resolveAnchoredSubject(
  cookieHeader: string | null,
  sessionSubject: string | null,
  db?: Db,
): Promise<AnchoredSubject | null> {
  const token = readCookie(cookieHeader, ANCHOR_COOKIE);
  const existing = await subjectForAnchor(token, db);
  if (existing) return { subjectHash: existing, setCookie: null };
  if (!sessionSubject) return null;
  const fresh = token && TOKEN_RE.test(token) ? token : newAnchorToken();
  const subjectHash = await bindAnchor(fresh, sessionSubject, db);
  return { subjectHash, setCookie: anchorCookie(fresh) };
}
