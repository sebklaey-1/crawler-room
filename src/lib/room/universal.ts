/**
 * The Universal Room: one global, public starting space.
 *
 * Scale rules:
 * - cursor-based pagination, never a full history load;
 * - time-based retention instead of the small per-room limits;
 * - aggregated, privacy-safe presence (never a list of online users);
 * - rate limiting, spam heuristics and idempotency keys on writes.
 */
import { generateAlias } from "./alias";
import { config } from "./config";
import { roomError } from "./errors";
import { encodeMessageId } from "./ids";
import { selectPlacements, type PlacementCard } from "./ads";
import { universalSettings } from "./plans";
import { enforceRateLimit } from "./ratelimit";
import { clampLimit, validateMessage } from "./validation";
import { countOnline, PRESENCE_WINDOW_SECONDS, type Db } from "./store";

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
  preferredAlias?: string | null,
): Promise<UniversalMembership & { joinedNow: boolean }> {
  const alias = preferredAlias ?? generateAlias(subjectHash + ":universal");
  const { data, error } = await db.rpc("join_universal_room", {
    p_subject_hash: subjectHash,
    p_alias: alias,
  });
  if (error) throw roomError("ROOM_UNAVAILABLE");
  const result = data as Record<string, any> | null;
  if (!result || result["error"]) throw roomError("ROOM_UNAVAILABLE");

  return {
    roomId: result["room_id"],
    membershipId: result["membership_id"],
    alias: result["alias"],
    joinedAt: result["joined_at"],
    lastReadMessageId: result["last_read_message_id"] ?? null,
    presence: Number(result["presence"] ?? 0),
    joinedNow: Boolean(result["joined_now"]),
  };
}

/** Never expose exact small numbers or a user list. */
export function presenceLabel(count: number): { bucket: string; approximate: number } {
  if (count <= 5) return { bucket: "einige Personen online", approximate: 5 };
  if (count <= 25) return { bucket: "viele Personen online", approximate: 25 };
  if (count <= 100) return { bucket: "sehr belebt", approximate: 100 };
  return { bucket: "hunderte Personen online", approximate: Math.round(count / 100) * 100 };
}

export interface UniversalFeedOptions {
  cursor?: string | null;
  limit?: number;
  topic?: string | null;
}

export async function universalFeed(
  db: Db,
  subjectHash: string,
  membership: UniversalMembership,
  options: UniversalFeedOptions,
) {
  const settings = await universalSettings(db);
  const limit = clampLimit(options.limit ?? settings.page_size, settings.page_size, 1, settings.max_page_size);

  let query = db
    .from("messages")
    .select("id, body, created_at, membership_id, memberships(alias)")
    .eq("room_id", membership.roomId)
    .gte("created_at", new Date(Date.now() - settings.retention_hours * 3600 * 1000).toISOString())
    .order("id", { ascending: false })
    .limit(limit + 1);

  const cursorId = options.cursor ? Number.parseInt(options.cursor, 10) : null;
  if (cursorId && Number.isFinite(cursorId)) query = query.lt("id", cursorId);

  const { data, error } = await query;
  if (error) throw roomError("INTERNAL_ERROR");

  const rows = (data ?? []) as any[];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  const messages = [];
  for (const row of page.reverse()) {
    messages.push({
      id: await encodeMessageId(row.id),
      alias: row.memberships?.alias ?? "Unbekannt",
      text: row.body as string,
      created_at: row.created_at as string,
      is_self: row.membership_id === membership.membershipId,
    });
  }

  const nextCursor = hasMore && page.length ? String(page[0].id) : null;

  const [trending, activeRooms, events, placements] = await Promise.all([
    trendingTopics(db),
    activePublicRooms(db),
    upcomingEvents(db),
    selectPlacements(db, subjectHash, { topic: options.topic ?? null }),
  ]);

  const presence = presenceLabel(membership.presence);
  const onlineNow = await countOnline(db, membership.roomId);

  return {
    room: {
      label: "Universal Room",
      presence: presence.bucket,
      approximate_online: presence.approximate,
      online_now: onlineNow,
      presence_window_seconds: PRESENCE_WINDOW_SECONDS,
      presence_checked_at: new Date().toISOString(),
    },
    messages,
    next_cursor: nextCursor,
    has_more: hasMore,
    trending_topics: trending,
    active_rooms: activeRooms,
    upcoming_events: events,
    sponsored: placements as PlacementCard[],
    notice:
      "Der Universal Room ist öffentlich. Gesponserte Karten sind immer als Anzeige gekennzeichnet und du entscheidest selbst, ob du sie betrittst.",
  };
}

export async function trendingTopics(db: Db, limit = 6) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await db
    .from("memberships")
    .select("topic_id, topics(slug, display_name)")
    .is("left_at", null)
    .gte("last_seen_at", since)
    .limit(1000);

  const counts = new Map<string, { slug: string; display_name: string; count: number }>();
  for (const row of ((data ?? []) as any[])) {
    const topic = row.topics;
    if (!topic || topic.slug === "universal") continue;
    const entry = counts.get(topic.slug) ?? { slug: topic.slug, display_name: topic.display_name, count: 0 };
    entry.count += 1;
    counts.set(topic.slug, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export async function activePublicRooms(db: Db, limit = 6) {
  const { data } = await db
    .from("rooms")
    .select("id, title, description, kind, capacity, topics(display_name)")
    .eq("visibility", "public")
    .in("kind", ["private", "community"])
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  return ((data ?? []) as any[]).map((room) => ({
    title: room.title ?? room.topics?.display_name ?? "Raum",
    description: room.description ?? "",
    capacity: room.capacity as number,
  }));
}

export async function upcomingEvents(db: Db, limit = 5) {
  const { data } = await db
    .from("events")
    .select("title, description, starts_at, status")
    .eq("visibility", "public")
    .in("status", ["scheduled", "live"])
    .gte("starts_at", new Date(Date.now() - 3600 * 1000).toISOString())
    .order("starts_at", { ascending: true })
    .limit(limit);
  return (data ?? []) as any[];
}

/** Lightweight promotional-flood heuristic for the public space. */
export function looksLikeSpam(text: string): boolean {
  const upperRatio = (text.match(/[A-ZÄÖÜ]/g)?.length ?? 0) / Math.max(text.length, 1);
  const repeated = /(.)\1{9,}/.test(text);
  const promo = /\b(kaufe jetzt|buy now|promo code|rabattcode|telegram\.me|whatsapp \+\d)/i.test(text);
  return repeated || promo || (text.length > 40 && upperRatio > 0.7);
}

export async function sendUniversalMessage(
  db: Db,
  subjectHash: string,
  membership: UniversalMembership,
  rawText: unknown,
  idempotencyKey?: string | null,
) {
  const settings = await universalSettings(db);
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
          id: await encodeMessageId((existing as any).id),
          alias: membership.alias,
          text: (existing as any).body,
          created_at: (existing as any).created_at,
          is_self: true,
        },
      };
    }
  }

  const text = validateMessage(rawText, {
    maxLength: cfg.maxMessageLength,
    maxLinks: 1,
  });
  if (looksLikeSpam(text)) throw roomError("POLICY_VIOLATION");

  await enforceRateLimit(db, subjectHash, "message", [
    { seconds: 60, max: settings.rate_per_minute },
    { seconds: 3600, max: settings.rate_per_hour },
  ]);

  const now = new Date();
  const { data, error } = await db
    .from("messages")
    .insert({
      room_id: membership.roomId,
      membership_id: membership.membershipId,
      body: text,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + settings.retention_hours * 3600 * 1000).toISOString(),
      idempotency_key: idempotencyKey ?? null,
    })
    .select("id, body, created_at")
    .single();
  if (error || !data) throw roomError("INTERNAL_ERROR");

  // Time-based retention keeps the public feed light.
  await db.rpc("enforce_text_retention", { p_room_id: membership.roomId });

  return {
    duplicate: false,
    message: {
      id: await encodeMessageId((data as any).id),
      alias: membership.alias,
      text: (data as any).body,
      created_at: (data as any).created_at,
      is_self: true,
    },
  };
}
