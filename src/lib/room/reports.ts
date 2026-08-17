/**
 * User reports, block management and the moderation queue.
 *
 * Design rules (OpenAI review hardening, phase 3):
 * - Reports are written with the service role only; the tables are RLS-locked
 *   with no policies, so neither anon nor authenticated can read them.
 * - A report never removes, hides or blocks content automatically. It creates
 *   a queue entry that a human resolves.
 * - The reporter is stored as the existing pseudonymous `subject_hash`, never
 *   as a raw subject, e-mail or account id.
 * - The public result carries no moderator, database or owner identifier —
 *   only `reported`, `already_reported`, `status` and an opaque receipt.
 * - Reported text is never copied in full: only a short tamper-evident hash of
 *   the target content is stored next to the existing target reference.
 */
import { embedded, type EmbeddedShapes } from "./dbtypes";
import { retentionCutoffIso } from "./config";
import { sha256Hex } from "./crypto";
import { roomError } from "./errors";
import { decodeImageId, decodeMessageId, decodeRoomId } from "./ids";
import { enforceRateLimit, WINDOWS } from "./ratelimit";
import type { Db } from "./store";

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate",
  "sexual_content",
  "violence",
  "self_harm",
  "privacy",
  "impersonation",
  "illegal_content",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ["received", "reviewing", "actioned", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type ReportTargetKind =
  // "organization" stays in the union for historical rows stored before the
  // organisation feature was removed from the public surface.
  "profile" | "room" | "message" | "image" | "community" | "organization";

export const REPORT_DETAILS_MAX = 500;

export const REPORT_DETAILS_HINT =
  "Describe the problem briefly. Do not add personal data about yourself or anyone else here.";

/** Trimmed free text, max 500 characters. Whitespace-only input is rejected. */
export function normalizeDetails(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw roomError("INVALID_INPUT", "Ungültige Zusatzangabe.");
  const value = raw.trim();
  if (!value) throw roomError("INVALID_INPUT", "Die Zusatzangabe darf nicht leer sein.");
  if (value.length > REPORT_DETAILS_MAX)
    throw roomError(
      "INVALID_INPUT",
      `Die Zusatzangabe darf höchstens ${REPORT_DETAILS_MAX} Zeichen haben.`,
    );
  return value;
}

function receiptId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return `rcpt_${out}`;
}

/** Short tamper-evident fingerprint — never the reported text itself. */
export async function snapshotHash(content: string): Promise<string> {
  return (await sha256Hex(new TextEncoder().encode(content))).slice(0, 32);
}

export interface ResolvedTarget {
  kind: ReportTargetKind;
  /** Internal reference, stored server-side only. */
  ref: string;
  roomId: string | null;
  ownerSubjectHash: string | null;
  snapshot: string | null;
  /** Public label for the confirmation message, already safe to show. */
  label: string;
}

/* ------------------------------ target lookup ----------------------------- */

async function messageTarget(
  db: Db,
  externalId: unknown,
  scope: { roomId?: string | null },
): Promise<ResolvedTarget> {
  const internalId = await decodeMessageId(externalId);
  if (!internalId) throw roomError("MESSAGE_NOT_FOUND");
  const { data } = await db
    .from("messages")
    .select("id, body, room_id, memberships(subject_hash)")
    .eq("id", internalId)
    .gte("created_at", retentionCutoffIso())
    .maybeSingle();
  const row = data;
  if (!row) throw roomError("MESSAGE_NOT_FOUND");
  if (scope.roomId && row.room_id !== scope.roomId)
    throw roomError("MESSAGE_NOT_FOUND", "Diese Nachricht gehört nicht zu diesem Raum.");
  return {
    kind: "message",
    ref: String(row.id),
    roomId: row.room_id,
    ownerSubjectHash:
      embedded<EmbeddedShapes["memberships"]>(row.memberships)?.subject_hash ?? null,
    snapshot: await snapshotHash(String(row.body ?? "")),
    label: "Nachricht",
  };
}

async function imageTarget(
  db: Db,
  externalId: unknown,
  scope: { roomId?: string | null },
): Promise<ResolvedTarget> {
  const internalId = await decodeImageId(externalId);
  if (!internalId) throw roomError("IMAGE_NOT_FOUND");
  const { data } = await db
    .from("image_messages")
    .select("id, storage_path, room_id, memberships:sender_membership_id(subject_hash)")
    .eq("id", internalId)
    .gte("created_at", retentionCutoffIso())
    .maybeSingle();
  const row = data;
  if (!row) throw roomError("IMAGE_NOT_FOUND");
  if (scope.roomId && row.room_id !== scope.roomId)
    throw roomError("IMAGE_NOT_FOUND", "Dieses Bild gehört nicht zu diesem Raum.");
  return {
    kind: "image",
    ref: String(row.id),
    roomId: row.room_id,
    ownerSubjectHash:
      embedded<EmbeddedShapes["memberships"]>(row.memberships)?.subject_hash ?? null,
    snapshot: await snapshotHash(String(row.storage_path ?? "")),
    label: "Bild",
  };
}

export async function universalRoomId(db: Db): Promise<string> {
  const { data } = await db
    .from("rooms")
    .select("id")
    .eq("kind", "universal")
    .limit(1)
    .maybeSingle();
  const id = data?.id as string | undefined;
  if (!id) throw roomError("ROOM_UNAVAILABLE");
  return id;
}

/** Universal Room: only messages and images that really live in that room. */
export async function resolveUniversalTarget(
  db: Db,
  targetType: "message" | "image",
  targetId: unknown,
): Promise<ResolvedTarget> {
  const roomId = await universalRoomId(db);
  return targetType === "message"
    ? messageTarget(db, targetId, { roomId })
    : imageTarget(db, targetId, { roomId });
}

/**
 * Community or community message. Organisations are no longer part of the
 * public surface and can therefore not be reported through it.
 */
export async function resolveCommunityTarget(
  db: Db,
  targetType: "community" | "message",
  reference: unknown,
  targetId: unknown,
): Promise<ResolvedTarget> {
  const raw = String(reference ?? "")
    .trim()
    .replace(/^@/, "");

  if (!raw) throw roomError("INVALID_INPUT", "Bitte nenne die Community.");
  const decodedRoom = await decodeRoomId(raw);
  const base = db
    .from("rooms")
    .select("id, slug, title")
    .eq("kind", "community")
    .is("archived_at", null);
  const { data } = decodedRoom
    ? await base.eq("id", decodedRoom).maybeSingle()
    : await base.ilike("slug", raw).maybeSingle();
  const community = data;
  if (!community) throw roomError("NOT_FOUND", "Diese Community gibt es nicht.");

  if (targetType === "message") return messageTarget(db, targetId, { roomId: community.id });

  return {
    kind: "community",
    ref: community.id,
    roomId: community.id,
    ownerSubjectHash: null,
    snapshot: await snapshotHash(`community:${community.slug ?? community.id}`),
    label: String(community.slug ?? community.title ?? "Community"),
  };
}

/* ------------------------------ submit report ----------------------------- */

export interface ReportReceipt {
  reported: true;
  already_reported: boolean;
  status: ReportStatus;
  receipt: string;
  message: string;
}

const RECEIVED_MESSAGE =
  "Danke, die Meldung ist eingegangen und wird von einem Menschen geprüft. Inhalte werden durch eine Meldung nicht automatisch entfernt.";

/**
 * Records a report. Idempotent per reporter and target: a second open report
 * for the same target returns the existing receipt instead of a new entry.
 */
export async function submitReport(
  db: Db,
  input: {
    reporterSubjectHash: string;
    target: ResolvedTarget;
    reason: ReportReason;
    details?: string | null;
  },
): Promise<ReportReceipt> {
  if (!REPORT_REASONS.includes(input.reason))
    throw roomError("INVALID_INPUT", "Bitte wähle einen gültigen Meldegrund.");

  if (
    input.target.ownerSubjectHash &&
    input.target.ownerSubjectHash === input.reporterSubjectHash
  ) {
    throw roomError("FORBIDDEN", "Eigene Inhalte kannst du nicht melden.");
  }

  const existing = await findOpenReport(db, input.reporterSubjectHash, input.target);
  if (existing) {
    return {
      reported: true,
      already_reported: true,
      status: existing.status,
      receipt: existing.receipt,
      message: "Diese Meldung liegt bereits vor und wird geprüft.",
    };
  }

  // Rate limit only for genuinely new reports, so retries are not punished.
  await enforceRateLimit(db, input.reporterSubjectHash, "report", WINDOWS.report(10));

  const receipt = receiptId();
  const { error } = await db.from("content_reports").insert({
    receipt,
    reporter_subject_hash: input.reporterSubjectHash,
    target_kind: input.target.kind,
    target_ref: input.target.ref,
    room_id: input.target.roomId,
    target_owner_subject_hash: input.target.ownerSubjectHash,
    target_snapshot_hash: input.target.snapshot,
    reason: input.reason,
    details: input.details ?? null,
    status: "received",
  });

  if (error) {
    // Unique violation: a concurrent request already created the open report.
    if (String(error.code).startsWith("23")) {
      const race = await findOpenReport(db, input.reporterSubjectHash, input.target);
      if (race) {
        return {
          reported: true,
          already_reported: true,
          status: race.status,
          receipt: race.receipt,
          message: "Diese Meldung liegt bereits vor und wird geprüft.",
        };
      }
    }
    throw roomError("INTERNAL_ERROR");
  }

  return {
    reported: true,
    already_reported: false,
    status: "received",
    receipt,
    message: RECEIVED_MESSAGE,
  };
}

async function findOpenReport(
  db: Db,
  reporterSubjectHash: string,
  target: ResolvedTarget,
): Promise<{ receipt: string; status: ReportStatus } | null> {
  const { data } = await db
    .from("content_reports")
    .select("receipt, status")
    .eq("reporter_subject_hash", reporterSubjectHash)
    .eq("target_kind", target.kind)
    .eq("target_ref", target.ref)
    .in("status", ["received", "reviewing"])
    .maybeSingle();
  const row = data;
  return row ? { receipt: row.receipt, status: row.status as ReportStatus } : null;
}

/* ------------------------------- moderation ------------------------------- */

/**
 * Moderator rights come from a server-side allowlist of hashed auth subjects
 * (`public.moderator_subjects`). No e-mail addresses and no UUIDs live in the
 * source code, and the table is unreachable through the Data API.
 */
export async function isModerator(db: Db, subjectHash: string): Promise<boolean> {
  if (!subjectHash) return false;
  const { data } = await db
    .from("moderator_subjects")
    .select("id")
    .eq("subject_hash", subjectHash)
    .eq("active", true)
    .maybeSingle();
  return Boolean(data);
}

/** Release gate: at least one real moderator identity must be configured. */
export async function moderationConfigured(db: Db): Promise<boolean> {
  const { count } = await db
    .from("moderator_subjects")
    .select("id", { count: "exact", head: true })
    .eq("active", true);
  return (count ?? 0) > 0;
}

export interface PendingReport {
  receipt: string;
  target_kind: ReportTargetKind;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  created_at: string;
}

/**
 * Internal moderation queue. NOT exposed as an MCP tool — it is called from
 * server-side moderation tooling and requires an allowlisted moderator.
 */
export async function listPendingReports(
  db: Db,
  moderatorSubjectHash: string,
  limit = 50,
): Promise<PendingReport[]> {
  if (!(await isModerator(db, moderatorSubjectHash))) throw roomError("FORBIDDEN");
  const { data, error } = await db
    .from("content_reports")
    .select("receipt, target_kind, reason, details, status, created_at")
    .in("status", ["received", "reviewing"])
    .order("created_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw roomError("INTERNAL_ERROR");
  return (data ?? []) as unknown as PendingReport[];
}

/** Human decision on a report. Never called from the public MCP surface. */
export async function resolveReport(
  db: Db,
  moderatorSubjectHash: string,
  receipt: string,
  decision: Exclude<ReportStatus, "received">,
  resolution?: string,
): Promise<{ receipt: string; status: ReportStatus }> {
  if (!(await isModerator(db, moderatorSubjectHash))) throw roomError("FORBIDDEN");
  if (!(["reviewing", "actioned", "dismissed"] as string[]).includes(decision))
    throw roomError("INVALID_INPUT");

  const patch: Record<string, unknown> = {
    status: decision,
    reviewer_hash: moderatorSubjectHash,
    resolution: resolution ?? null,
    resolved_at: decision === "reviewing" ? null : new Date().toISOString(),
  };

  const { data, error } = await db
    .from("content_reports")
    .update(patch)
    .eq("receipt", receipt)
    .select("receipt, status")
    .maybeSingle();
  if (error) throw roomError("INTERNAL_ERROR");
  if (!data) throw roomError("NOT_FOUND");
  return data as unknown as { receipt: string; status: ReportStatus };
}
