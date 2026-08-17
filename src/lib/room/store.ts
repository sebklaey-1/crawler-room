/**
 * Server-only data access. All queries run with the service role key inside
 * request handlers — the browser never talks to the database.
 */
import { embedded, type EmbeddedShapes } from "./dbtypes";
import type { SupabaseClient } from "@supabase/supabase-js";

import { aliasKey, MAX_ALIAS_LENGTH } from "./alias";
import { retentionDeadlineIso } from "./config";
import { roomError } from "./errors";

export type Db = SupabaseClient;

/** True only inside the vitest process. Never true in a deployed runtime. */
function isTestRuntime(): boolean {
  return process.env["NODE_ENV"] === "test";
}

let testDb: Db | null = null;

/**
 * Test-only database injection. Outside `NODE_ENV=test` this is a no-op and
 * the override is never consulted, so it cannot weaken production. Inside the
 * test runtime `getDb()` is fail-closed: without an explicit override it
 * refuses to load the real service-role client, so a normal `bun run test`
 * can never open a connection to a live database.
 */
export function __setTestDb(db: Db | null): void {
  if (!isTestRuntime()) return;
  testDb = db;
}

export async function getDb(): Promise<Db> {
  if (isTestRuntime()) {
    if (testDb) return testDb;
    throw new Error(
      "getDb() is disabled in tests: inject a fake with __setTestDb(db). " +
        "Real database access belongs in the opt-in contract suite (bun run test:db).",
    );
  }
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
  const { data, error } = await db.from("topic_aliases").select("normalized_alias, topics(slug)");
  if (error) return {};
  const map: Record<string, string> = {};
  for (const row of (data ?? []) as unknown as Array<{
    normalized_alias: string;
    topics: { slug: string } | null;
  }>) {
    const slug = embedded<EmbeddedShapes["topics"]>(row.topics)?.slug;
    if (slug) map[row.normalized_alias] = slug;
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

  const result = data as {
    error?: string;
    membership_id?: string;
    alias?: string;
    joined_at?: string;
    last_read_message_id?: number | null;
    room_id?: string;
    room_number?: number;
    capacity?: number;
    member_count?: number;
    topic_slug?: string;
    topic_display_name?: string;
    joined_now?: boolean;
  } | null;
  if (!result) throw roomError("ROOM_UNAVAILABLE");
  if (result.error === "TOPIC_NOT_FOUND") throw roomError("TOPIC_NOT_FOUND");
  if (!result.membership_id || !result.room_id) throw roomError("ROOM_UNAVAILABLE");

  return {
    membershipId: result.membership_id,
    alias: result.alias ?? alias,
    joinedAt: result.joined_at ?? new Date().toISOString(),
    lastReadMessageId: result.last_read_message_id ?? null,
    roomId: result.room_id,
    roomNumber: result.room_number ?? 1,
    capacity: result.capacity ?? 0,
    memberCount: result.member_count ?? 0,
    topic: {
      slug: result.topic_slug ?? topicSlug,
      display_name: result.topic_display_name ?? result.topic_slug ?? topicSlug,
    },
    joinedNow: Boolean(result.joined_now),
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
    .eq("topic_id", topic.id)
    .is("left_at", null)
    .maybeSingle();
  if (error) throw roomError("INTERNAL_ERROR");
  if (!data) return null;

  const row = data;
  const memberCount = await countActiveMembers(db, row.room_id);
  return {
    membershipId: row.id,
    alias: row.alias,
    joinedAt: row.joined_at,
    lastReadMessageId: row.last_read_message_id,
    roomId: row.room_id,
    roomNumber: embedded<EmbeddedShapes["rooms"]>(row.rooms)?.room_number ?? 1,
    capacity: embedded<EmbeddedShapes["rooms"]>(row.rooms)?.capacity ?? 0,
    memberCount,
    topic: { slug: topic.slug, display_name: topic.display_name },
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

  const rows = data ?? [];
  const hasMore = rows.length > options.limit;
  const visible = rows.slice(0, options.limit).map((row) => ({
    id: row.id as number,
    body: row.body as string,
    created_at: row.created_at as string,
    membership_id: row.membership_id as string,
    alias:
      (embedded<EmbeddedShapes["memberships"]>(row.memberships)?.alias as string) ?? "Unbekannt",
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
  // Hard cap: never later than created_at + 24h, whatever the room says.
  const expiresAt = new Date(
    Math.min(now.getTime() + retentionHours * 3600 * 1000, Date.parse(retentionDeadlineIso(now))),
  );
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
  const row = data;

  // Rolling retention: a room keeps only its newest 7 text messages.
  const { enforceRoomRetention } = await import("./retention");
  await enforceRoomRetention(db, membership.roomId);

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
    .select(
      "id, alias, joined_at, last_read_message_id, room_id, rooms(room_number, capacity), topics(slug, display_name)",
    )
    .eq("subject_hash", subjectHash)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  if (error) throw roomError("INTERNAL_ERROR");
  return data ?? [];
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

/* --------------------------- live presence --------------------------- */

/** A member counts as "online" when seen within this window. */
export const PRESENCE_WINDOW_SECONDS = 180;

/** Heartbeat: every tool call marks the caller as present in all their rooms. */
export async function touchPresence(db: Db, subjectHash: string): Promise<void> {
  await db
    .from("memberships")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("subject_hash", subjectHash)
    .is("left_at", null);
}

/** Exact number of members active in a room right now. */
export async function countOnline(
  db: Db,
  roomId: string,
  windowSeconds: number = PRESENCE_WINDOW_SECONDS,
): Promise<number> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error } = await db
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("room_id", roomId)
    .is("left_at", null)
    .gte("last_seen_at", since);
  if (error) throw roomError("INTERNAL_ERROR");
  return count ?? 0;
}

/** Persisted display name chosen by the person, or null. */
export async function getCustomAlias(db: Db, subjectHash: string): Promise<string | null> {
  const { data } = await db
    .from("anonymous_identities")
    .select("custom_alias")
    .eq("subject_hash", subjectHash)
    .maybeSingle();
  return (data?.custom_alias as string | null) ?? null;
}

/**
 * UX pre-check: true when another identity already holds this public user
 * name. NFKC, case and trim variants are the same name. The claim registry in
 * the database stays the authority and rejects colliding writes even in a race.
 */
export async function isAliasTaken(db: Db, subjectHash: string, alias: string): Promise<boolean> {
  const key = aliasKey(alias);
  if (!key) return false;
  const { data, error } = await db
    .from("name_claims")
    .select("owner_subject_hash")
    .eq("kind", "alias")
    .eq("normalized", key)
    .maybeSingle();
  if (error) throw roomError("INTERNAL_ERROR");
  return Boolean(data) && data?.owner_subject_hash !== subjectHash;
}

/** Up to three free variants of a taken public user name. No IDs, no hashes. */
export async function suggestAliases(
  db: Db,
  subjectHash: string,
  alias: string,
): Promise<string[]> {
  const base = alias.normalize("NFKC").replace(/\s+/g, " ").trim();
  const out: string[] = [];
  for (let i = 2; i <= 12 && out.length < 3; i += 1) {
    const suffix = ` ${i}`;
    const candidate = `${base.slice(0, MAX_ALIAS_LENGTH - suffix.length).trim()}${suffix}`;
    if (!aliasKey(candidate)) continue;
    if (!(await isAliasTaken(db, subjectHash, candidate))) out.push(candidate);
  }
  return out;
}
