/**
 * Server-only data access. All queries run with the service role key inside
 * request handlers — the browser never talks to the database.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { roomError } from "./errors";

export type Db = SupabaseClient<any, "public", any>;

export async function getDb(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

export interface TopicRow {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
}

export interface MembershipContext {
  membershipId: string;
  alias: string;
  joinedAt: string;
  lastReadMessageId: number | null;
  roomId: string;
  roomNumber: number;
  capacity: number;
  memberCount: number;
  topic: { slug: string; display_name: string };
}

export async function listTopics(db: Db): Promise<TopicRow[]> {
  const { data, error } = await db
    .from("topics")
    .select("id, slug, display_name, description")
    .eq("enabled", true)
    .order("created_at", { ascending: true });
  if (error) throw roomError("INTERNAL_ERROR");
  return (data ?? []) as TopicRow[];
}

export async function loadAliasMap(db: Db): Promise<Record<string, string>> {
  const { data, error } = await db
    .from("topic_aliases")
    .select("normalized_alias, topics(slug)");
  if (error) return {};
  const map: Record<string, string> = {};
  for (const row of (data ?? []) as unknown as Array<{
    normalized_alias: string;
    topics: { slug: string } | null;
  }>) {
    if (row.topics?.slug) map[row.normalized_alias] = row.topics.slug;
  }

  return map;
}

export function roomLabel(topicDisplayName: string, roomNumber: number): string {
  return `${topicDisplayName} · Raum ${roomNumber}`;
}

/** Transactional join / idempotent membership lookup (SQL function). */
export async function joinTopicRoom(
  db: Db,
  subjectHash: string,
  topicSlug: string,
  alias: string,
): Promise<MembershipContext & { joinedNow: boolean }> {
  const { data, error } = await db.rpc("join_topic_room", {
    p_subject_hash: subjectHash,
    p_topic_slug: topicSlug,
    p_alias: alias,
  });
  if (error) throw roomError("ROOM_UNAVAILABLE");

  const result = data as Record<string, any> | null;
  if (!result) throw roomError("ROOM_UNAVAILABLE");
  if (result["error"] === "TOPIC_NOT_FOUND") throw roomError("TOPIC_NOT_FOUND");

  return {
    membershipId: result["membership_id"],
    alias: result["alias"],
    joinedAt: result["joined_at"],
    lastReadMessageId: result["last_read_message_id"] ?? null,
    roomId: result["room_id"],
    roomNumber: result["room_number"],
    capacity: result["capacity"],
    memberCount: result["member_count"],
    topic: { slug: result["topic_slug"], display_name: result["topic_display_name"] },
    joinedNow: Boolean(result["joined_now"]),
  };
}

/** Active membership for a subject in a topic, or null. */
export async function getActiveMembership(
  db: Db,
  subjectHash: string,
  topicSlug: string,
): Promise<MembershipContext | null> {
  const { data: topic, error: topicError } = await db
    .from("topics")
    .select("id, slug, display_name")
    .eq("slug", topicSlug)
    .eq("enabled", true)
    .maybeSingle();
  if (topicError) throw roomError("INTERNAL_ERROR");
  if (!topic) throw roomError("TOPIC_NOT_FOUND");

  const { data, error } = await db
    .from("memberships")
    .select("id, alias, joined_at, last_read_message_id, room_id, rooms(room_number, capacity)")
    .eq("subject_hash", subjectHash)
    .eq("topic_id", (topic as any).id)
    .is("left_at", null)
    .maybeSingle();
  if (error) throw roomError("INTERNAL_ERROR");
  if (!data) return null;

  const row = data as any;
  const memberCount = await countActiveMembers(db, row.room_id);
  return {
    membershipId: row.id,
    alias: row.alias,
    joinedAt: row.joined_at,
    lastReadMessageId: row.last_read_message_id,
    roomId: row.room_id,
    roomNumber: row.rooms.room_number,
    capacity: row.rooms.capacity,
    memberCount,
    topic: { slug: (topic as any).slug, display_name: (topic as any).display_name },
  };
}

export async function countActiveMembers(db: Db, roomId: string): Promise<number> {
  const { count, error } = await db
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("room_id", roomId)
    .is("left_at", null);
  if (error) throw roomError("INTERNAL_ERROR");
  return count ?? 0;
}

export interface MessageRow {
  id: number;
  body: string;
  created_at: string;
  membership_id: string;
  alias: string;
}

/**
 * Messages visible to a membership: same room, created after joined_at,
 * not expired. `afterId` restricts to unread messages.
 */
export async function fetchVisibleMessages(
  db: Db,
  membership: MembershipContext,
  options: { afterId?: number | null; limit: number },
): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
  let query = db
    .from("messages")
    .select("id, body, created_at, membership_id, memberships(alias)")
    .eq("room_id", membership.roomId)
    .gte("created_at", membership.joinedAt)
    .gt("expires_at", new Date().toISOString())
    .order("id", { ascending: true })
    .limit(options.limit + 1);

  if (options.afterId) query = query.gt("id", options.afterId);

  const { data, error } = await query;
  if (error) throw roomError("INTERNAL_ERROR");

  const rows = (data ?? []) as any[];
  const hasMore = rows.length > options.limit;
  const visible = rows.slice(0, options.limit).map((row) => ({
    id: row.id as number,
    body: row.body as string,
    created_at: row.created_at as string,
    membership_id: row.membership_id as string,
    alias: (row.memberships?.alias as string) ?? "Unbekannt",
  }));
  return { messages: visible, hasMore };
}

export async function countUnread(db: Db, membership: MembershipContext): Promise<number> {
  let query = db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("room_id", membership.roomId)
    .gte("created_at", membership.joinedAt)
    .gt("expires_at", new Date().toISOString());
  if (membership.lastReadMessageId) query = query.gt("id", membership.lastReadMessageId);
  const { count, error } = await query;
  if (error) throw roomError("INTERNAL_ERROR");
  return count ?? 0;
}

export async function updateReadCursor(db: Db, membershipId: string, messageId: number | null) {
  const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
  if (messageId !== null) patch["last_read_message_id"] = messageId;
  const { error } = await db.from("memberships").update(patch).eq("id", membershipId);
  if (error) throw roomError("INTERNAL_ERROR");
}

export async function insertMessage(
  db: Db,
  membership: MembershipContext,
  body: string,
  retentionHours: number,
): Promise<MessageRow> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + retentionHours * 3600 * 1000);
  const { data, error } = await db
    .from("messages")
    .insert({
      room_id: membership.roomId,
      membership_id: membership.membershipId,
      body,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select("id, body, created_at, membership_id")
    .single();
  if (error || !data) throw roomError("INTERNAL_ERROR");
  const row = data as any;

  // Rolling retention: a room keeps only its newest 7 text messages.
  const { enforceTextRetention } = await import("./imagestore");
  await enforceTextRetention(db, membership.roomId);

  return {
    id: row.id,
    body: row.body,
    created_at: row.created_at,
    membership_id: row.membership_id,
    alias: membership.alias,
  };
}


export async function leaveTopic(db: Db, subjectHash: string, topicSlug: string) {
  const membership = await getActiveMembership(db, subjectHash, topicSlug);
  if (!membership) return null;
  const { error } = await db
    .from("memberships")
    .update({ left_at: new Date().toISOString() })
    .eq("id", membership.membershipId);
  if (error) throw roomError("INTERNAL_ERROR");
  return membership;
}

export async function listMyRooms(db: Db, subjectHash: string) {
  const { data, error } = await db
    .from("memberships")
    .select("id, alias, joined_at, last_read_message_id, room_id, rooms(room_number, capacity), topics(slug, display_name)")
    .eq("subject_hash", subjectHash)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  if (error) throw roomError("INTERNAL_ERROR");
  return (data ?? []) as any[];
}

export async function insertReport(
  db: Db,
  target: { messageId?: number; imageMessageId?: number },
  reporterMembershipId: string,
  reason: string,
) {
  const { error } = await db.from("message_reports").insert({
    message_id: target.messageId ?? null,
    image_message_id: target.imageMessageId ?? null,
    reporter_membership_id: reporterMembershipId,
    reason,
  });
  if (error) throw roomError("INTERNAL_ERROR");
}
