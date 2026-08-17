/**
 * The Universal Room: the one global, public space of Crawler Room.
 *
 * Rules:
 * - every caller is pseudonymous; the pseudonym is derived server-side;
 * - cursor-based pagination, never a full history load;
 * - time-based retention plus a rolling newest-messages window;
 * - aggregated, privacy-safe presence (never a list of online users);
 * - rate limiting, spam heuristics and idempotency keys on writes.
 */
import { generateAlias } from "./alias";
import { config, retentionDeadlineIso } from "./config";
import { roomError } from "./errors";
import { encodeMessageId } from "./ids";
import { enforceRateLimit } from "./ratelimit";
import { enforceRoomRetention } from "./retention";
import { validateMessage } from "./validation";
import type { Db } from "./store";

/** Write limits for the public room. */
const RATE_PER_MINUTE = 10;
const RATE_PER_HOUR = 120;

export interface UniversalMembership {
  roomId: string;
  membershipId: string;
  alias: string;
  joinedAt: string;
  lastReadMessageId: number | null;
  presence: number;
}

export async function enterUniversal(
  db: Db,
  subjectHash: string,
): Promise<UniversalMembership & { joinedNow: boolean }> {
  // The pseudonym is deterministic per subject: nobody can pick or change it.
  const alias = generateAlias(subjectHash + ":universal");
  const { data, error } = await db.rpc("join_universal_room", {
    p_subject_hash: subjectHash,
    p_alias: alias,
  });
  if (error) throw roomError("ROOM_UNAVAILABLE");
  const result = data as {
    error?: string;
    room_id?: string;
    membership_id?: string;
    alias?: string;
    joined_at?: string;
    last_read_message_id?: number | null;
    presence?: number;
    joined_now?: boolean;
  } | null;
  if (!result?.room_id || !result.membership_id) throw roomError("ROOM_UNAVAILABLE");

  return {
    roomId: result.room_id,
    membershipId: result.membership_id,
    alias: result.alias ?? alias,
    joinedAt: result.joined_at ?? new Date().toISOString(),
    lastReadMessageId: result.last_read_message_id ?? null,
    presence: Number(result.presence ?? 0),
    joinedNow: Boolean(result.joined_now),
  };
}

/** Lightweight promotional-flood heuristic for the public space. */
export function looksLikeSpam(text: string): boolean {
  const upperRatio = (text.match(/[A-ZÄÖÜ]/g)?.length ?? 0) / Math.max(text.length, 1);
  const repeated = /(.)\1{9,}/.test(text);
  const promo = /\b(kaufe jetzt|buy now|promo code|rabattcode|telegram\.me|whatsapp \+\d)/i.test(
    text,
  );
  return repeated || promo || (text.length > 40 && upperRatio > 0.7);
}

export async function sendUniversalMessage(
  db: Db,
  subjectHash: string,
  membership: UniversalMembership,
  rawText: unknown,
  idempotencyKey?: string | null,
) {
  const cfg = config();

  if (idempotencyKey) {
    const { data: existing } = await db
      .from("messages")
      .select("id, body, created_at")
      .eq("membership_id", membership.membershipId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) {
      return {
        duplicate: true,
        message: {
          id: await encodeMessageId(existing.id),
          alias: membership.alias,
          text: existing.body,
          created_at: new Date(existing.created_at).toISOString(),
          is_self: true,
        },
      };
    }
  }

  const text = validateMessage(rawText, { maxLength: cfg.maxMessageLength, maxLinks: 1 });
  if (looksLikeSpam(text)) throw roomError("POLICY_VIOLATION");

  await enforceRateLimit(db, subjectHash, "message", [
    { seconds: 60, max: RATE_PER_MINUTE },
    { seconds: 3600, max: RATE_PER_HOUR },
  ]);

  const now = new Date();
  const { data, error } = await db
    .from("messages")
    .insert({
      room_id: membership.roomId,
      membership_id: membership.membershipId,
      body: text,
      created_at: now.toISOString(),
      expires_at: retentionDeadlineIso(now),
      idempotency_key: idempotencyKey ?? null,
    })
    .select("id, body, created_at")
    .single();
  if (error || !data) throw roomError("INTERNAL_ERROR");

  await enforceRoomRetention(db, membership.roomId);

  return {
    duplicate: false,
    message: {
      id: await encodeMessageId(data.id),
      alias: membership.alias,
      text: data.body,
      created_at: new Date(data.created_at).toISOString(),
      is_self: true,
    },
  };
}
