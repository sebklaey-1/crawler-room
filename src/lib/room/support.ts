/**
 * Public support / abuse channel and privacy (deletion) requests.
 *
 * DATA MINIMISATION
 * - No raw IP address is ever stored. When abuse protection needs a
 *   per-requester signal, only HMAC-SHA256(SUBJECT_HASH_SECRET, "support:" + x)
 *   over a trusted request metadata value is persisted, and only for 24 hours.
 * - Deletion requests never store the raw Supabase user id; only
 *   HMAC-SHA256(SUBJECT_HASH_SECRET, "auth:" + sub) is written.
 * - Callers only ever receive an opaque case reference — never a database id,
 *   a status timestamp or any other internal field.
 */
import { z } from "zod";

import { requireSecret } from "./config";
import { hmacSha256Hex, randomId } from "./crypto";
import { roomError } from "./errors";
import type { Db } from "./store";

export const SUPPORT_CATEGORIES = ["technical", "account", "privacy", "abuse", "other"] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** Hard payload ceiling for the public form endpoint. */
export const MAX_SUPPORT_BODY_BYTES = 16 * 1024;

/** How long the abuse-protection pseudonym survives. */
export const REQUESTER_HASH_TTL_HOURS = 24;

/** How long a support request itself is retained. */
export const SUPPORT_RETENTION_DAYS = 90;

const trimmed = (max: number) => z.string().trim().max(max);

export const supportRequestSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  subject: trimmed(120).min(3),
  message: trimmed(4000).min(20),
  contact: trimmed(200).optional().or(z.literal("")),
  handle: trimmed(64).optional().or(z.literal("")),
  // Honeypot: must stay empty. Real browsers never fill a hidden field.
  website: z.string().max(200).optional(),
});

export type SupportRequestInput = z.infer<typeof supportRequestSchema>;

/** Opaque, non-enumerable case reference. */
export function caseReference(): string {
  return `RC-${randomId(6).toUpperCase()}`;
}

/** Keyed, short-lived pseudonym derived from trusted request metadata. */
export async function requesterHash(value: string | null | undefined): Promise<string | null> {
  const trimmedValue = (value ?? "").trim();
  if (!trimmedValue) return null;
  return hmacSha256Hex(requireSecret("SUBJECT_HASH_SECRET"), `support:${trimmedValue}`);
}

/** Rate limit window for the public form: per hash (or shared bucket) per hour. */
const SUPPORT_LIMIT_PER_HOUR = 5;

async function enforceSupportLimit(db: Db, bucket: string): Promise<void> {
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const { data, error } = await db
    .from("rate_events")
    .select("created_at")
    .eq("subject_hash", bucket)
    .eq("action", "support")
    .gte("created_at", since);
  if (error) throw roomError("INTERNAL_ERROR");
  if ((data ?? []).length >= SUPPORT_LIMIT_PER_HOUR) throw roomError("RATE_LIMITED");

  const { error: insertError } = await db
    .from("rate_events")
    .insert({ subject_hash: bucket, action: "support" });
  if (insertError) throw roomError("INTERNAL_ERROR");
}

export interface SupportResult {
  reference: string;
  received: true;
}

/**
 * Validates and stores a support / abuse report.
 * Honeypot hits look successful to the sender but are never persisted.
 */
export async function submitSupportRequest(
  db: Db,
  raw: unknown,
  options: { requestFingerprint?: string | null } = {},
): Promise<SupportResult> {
  const parsed = supportRequestSchema.safeParse(raw);
  if (!parsed.success) throw roomError("INVALID_INPUT");
  const input = parsed.data;

  if ((input.website ?? "").trim().length > 0) {
    // Silent drop: no database write, no rate-limit consumption.
    return { reference: caseReference(), received: true };
  }

  const hash = await requesterHash(options.requestFingerprint ?? null);
  await enforceSupportLimit(db, hash ?? "support:anonymous");

  const reference = caseReference();
  const now = Date.now();
  const { error } = await db.from("support_requests").insert({
    reference,
    category: input.category,
    subject: input.subject,
    body: input.message,
    contact: input.contact ? input.contact : null,
    public_target: input.handle ? input.handle.replace(/^@/, "") : null,
    requester_hash: hash,
    requester_hash_expires_at: hash
      ? new Date(now + REQUESTER_HASH_TTL_HOURS * 3600 * 1000).toISOString()
      : null,
    expires_at: new Date(now + SUPPORT_RETENTION_DAYS * 86400 * 1000).toISOString(),
  });
  if (error) throw roomError("INTERNAL_ERROR");

  return { reference, received: true };
}

/* ---------------------------- privacy requests ---------------------------- */

export interface DeletionResult {
  reference: string;
  status: "pending";
  duplicate: boolean;
}

/**
 * Records a verified deletion request. Nothing is deleted here: the request is
 * logged with a pending status so the outcome stays auditable, and a second
 * open request for the same account reuses the existing case reference.
 */
export async function submitDeletionRequest(
  db: Db,
  authUserHash: string,
  note?: string,
): Promise<DeletionResult> {
  if (!/^[0-9a-f]{64}$/.test(authUserHash)) throw roomError("INVALID_INPUT");
  const cleanNote = (note ?? "").trim().slice(0, 1000) || null;

  const existing = await openDeletionRequest(db, authUserHash);
  if (existing) return { reference: existing, status: "pending", duplicate: true };

  const reference = caseReference();
  const { error } = await db.from("privacy_requests").insert({
    reference,
    request_type: "deletion",
    auth_user_hash: authUserHash,
    note: cleanNote,
    expires_at: new Date(Date.now() + SUPPORT_RETENTION_DAYS * 86400 * 1000).toISOString(),
  });

  if (error) {
    // Unique race on the partial index: re-read the winning request.
    const raced = await openDeletionRequest(db, authUserHash);
    if (raced) return { reference: raced, status: "pending", duplicate: true };
    throw roomError("INTERNAL_ERROR");
  }

  return { reference, status: "pending", duplicate: false };
}

async function openDeletionRequest(db: Db, authUserHash: string): Promise<string | null> {
  const { data, error } = await db
    .from("privacy_requests")
    .select("reference")
    .eq("auth_user_hash", authUserHash)
    .eq("request_type", "deletion")
    .in("status", ["pending", "in_review"])
    .maybeSingle();
  if (error) throw roomError("INTERNAL_ERROR");
  return (data as { reference?: string } | null)?.reference ?? null;
}

/* -------------------------------- retention ------------------------------- */

/**
 * Executed retention: removes expired support requests, clears the 24h
 * abuse-protection pseudonym and drops finished privacy requests.
 */
export async function cleanupSupportData(db: Db): Promise<Record<string, number>> {
  const { data, error } = await db.rpc("cleanup_support_requests");
  if (error) throw roomError("INTERNAL_ERROR");
  const result = (data ?? {}) as Record<string, number>;
  return result;
}
