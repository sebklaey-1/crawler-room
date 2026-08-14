/**
 * @room MCP tool implementations.
 *
 * Every handler:
 * - derives identity server-side from MCP `_meta` (never from tool input),
 * - validates input,
 * - returns only data the caller is allowed to see,
 * - never exposes internal UUIDs, subjects, sessions or secrets.
 */
import { z } from "zod";

import { generateAlias, sanitizeAlias } from "./alias";
import { config } from "./config";
import { roomError } from "./errors";
import { resolveIdentity, type McpMeta } from "./identity";
import { decodeMessageId, encodeMessageId } from "./ids";
import { enforceRateLimit, WINDOWS } from "./ratelimit";
import {
  countUnread,
  fetchVisibleMessages,
  getActiveMembership,
  getDb,
  insertMessage,
  insertReport,
  joinTopicRoom,
  leaveTopic,
  listMyRooms,
  listTopics,
  loadAliasMap,
  roomLabel,
  updateReadCursor,
  type Db,
  type MembershipContext,
  type MessageRow,
} from "./store";
import { resolveTopicSlug, TOPIC_ALIASES } from "./topics";
import { clampLimit, validateMessage } from "./validation";

const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate",
  "sexual_content",
  "violence",
  "personal_data",
  "other",
] as const;

export const inputSchemas = {
  list_topics: z.object({}).strict(),
  enter_topic: z.object({ topic: z.string().min(1), alias: z.string().optional() }).strict(),
  send_message: z.object({ topic: z.string().min(1), text: z.string() }).strict(),
  read_messages: z.object({ topic: z.string().min(1), limit: z.number().optional() }).strict(),
  my_rooms: z.object({}).strict(),
  leave_topic: z.object({ topic: z.string().min(1) }).strict(),
  report_message: z
    .object({
      topic: z.string().min(1),
      message_id: z.string().min(1),
      reason: z.enum(REPORT_REASONS),
    })
    .strict(),
};

async function resolveSlug(db: Db, raw: string): Promise<string> {
  const aliases = { ...TOPIC_ALIASES, ...(await loadAliasMap(db)) };
  const slug = resolveTopicSlug(raw, aliases);
  if (!slug) {
    const topics = await listTopics(db);
    throw roomError("TOPIC_NOT_FOUND", "Dieses Thema kenne ich nicht.", {
      available_topics: topics.map((topic) => ({
        slug: topic.slug,
        display_name: topic.display_name,
      })),
    });
  }
  return slug;
}

function roomPayload(membership: MembershipContext) {
  return {
    label: roomLabel(membership.topic.display_name, membership.roomNumber),
    member_count: membership.memberCount,
    capacity: membership.capacity,
  };
}

async function serializeMessages(rows: MessageRow[], membership: MembershipContext) {
  return Promise.all(
    rows.map(async (row) => ({
      id: await encodeMessageId(row.id),
      alias: row.alias,
      text: row.body,
      created_at: new Date(row.created_at).toISOString(),
      is_self: row.membership_id === membership.membershipId,
    })),
  );
}

async function requireMembership(db: Db, subjectHash: string, topicSlug: string) {
  const membership = await getActiveMembership(db, subjectHash, topicSlug);
  if (!membership) throw roomError("NOT_A_MEMBER");
  return membership;
}

/* ------------------------------- handlers ------------------------------- */

export async function handleListTopics() {
  const db = await getDb();
  const topics = await listTopics(db);
  return {
    topics: topics.map((topic) => ({
      slug: topic.slug,
      display_name: topic.display_name,
      description: topic.description ?? "",
    })),
  };
}

export async function handleEnterTopic(input: unknown, meta: McpMeta) {
  const { topic, alias } = inputSchemas.enter_topic.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const slug = await resolveSlug(db, topic);
  const settings = config();

  const existing = await getActiveMembership(db, identity.subjectHash, slug);
  if (!existing) {
    await enforceRateLimit(db, identity.subjectHash, "join", WINDOWS.join(settings.joinLimitPerHour));
  }

  const desiredAlias =
    sanitizeAlias(alias) ?? generateAlias(`${identity.subjectHash}:${slug}`);
  const membership = await joinTopicRoom(db, identity.subjectHash, slug, desiredAlias);

  const { messages } = await fetchVisibleMessages(db, membership, {
    afterId: membership.lastReadMessageId,
    limit: 20,
  });
  const unread = await countUnread(db, membership);
  const lastId = messages.length ? messages[messages.length - 1]!.id : null;
  await updateReadCursor(db, membership.membershipId, lastId);

  return {
    topic: { slug: membership.topic.slug, display_name: membership.topic.display_name },
    room: roomPayload(membership),
    membership: { alias: membership.alias, joined_now: membership.joinedNow },
    messages: await serializeMessages(messages, membership),
    unread_count: unread,
  };
}

export async function handleSendMessage(input: unknown, meta: McpMeta) {
  const { topic, text } = inputSchemas.send_message.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const slug = await resolveSlug(db, topic);
  const settings = config();

  const membership = await requireMembership(db, identity.subjectHash, slug);
  const body = validateMessage(text, {
    maxLength: settings.maxMessageLength,
    maxLinks: settings.maxLinksPerMessage,
  });

  await enforceRateLimit(
    db,
    identity.subjectHash,
    "message",
    WINDOWS.message(settings.rateLimitPerMinute, settings.rateLimitPerHour),
  );

  const sent = await insertMessage(db, membership, body, settings.messageRetentionHours);

  const { messages } = await fetchVisibleMessages(db, membership, {
    afterId: membership.lastReadMessageId,
    limit: 20,
  });
  const others = messages.filter((row) => row.id !== sent.id);
  const lastId = messages.length ? messages[messages.length - 1]!.id : sent.id;
  await updateReadCursor(db, membership.membershipId, Math.max(lastId, sent.id));

  return {
    sent: true,
    topic: { slug: membership.topic.slug, display_name: membership.topic.display_name },
    room: roomPayload(membership),
    sent_message: {
      id: await encodeMessageId(sent.id),
      alias: membership.alias,
      text: sent.body,
      created_at: new Date(sent.created_at).toISOString(),
      is_self: true,
    },
    new_messages: await serializeMessages(others, membership),
    unread_count: 0,
  };
}

export async function handleReadMessages(input: unknown, meta: McpMeta) {
  const { topic, limit } = inputSchemas.read_messages.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const slug = await resolveSlug(db, topic);

  const membership = await requireMembership(db, identity.subjectHash, slug);
  const take = clampLimit(limit);
  const unread = await countUnread(db, membership);

  const { messages, hasMore } = await fetchVisibleMessages(db, membership, {
    afterId: unread > 0 ? membership.lastReadMessageId : null,
    limit: take,
  });

  const lastId = messages.length ? messages[messages.length - 1]!.id : null;
  await updateReadCursor(db, membership.membershipId, lastId);

  return {
    topic: { slug: membership.topic.slug, display_name: membership.topic.display_name },
    room: roomPayload(membership),
    messages: await serializeMessages(messages, membership),
    unread_count: unread,
    has_more: hasMore,
  };
}

export async function handleMyRooms(_input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const rows = await listMyRooms(db, identity.subjectHash);

  const rooms = [];
  for (const row of rows) {
    const membership: MembershipContext = {
      membershipId: row.id,
      alias: row.alias,
      joinedAt: row.joined_at,
      lastReadMessageId: row.last_read_message_id,
      roomId: row.room_id,
      roomNumber: row.rooms.room_number,
      capacity: row.rooms.capacity,
      memberCount: 0,
      topic: { slug: row.topics.slug, display_name: row.topics.display_name },
    };
    const { getActiveMembership: _unused } = { getActiveMembership };
    void _unused;
    const memberCount = (await getActiveMembership(db, identity.subjectHash, membership.topic.slug))
      ?.memberCount ?? 0;
    rooms.push({
      topic_slug: membership.topic.slug,
      topic_display_name: membership.topic.display_name,
      room_label: roomLabel(membership.topic.display_name, membership.roomNumber),
      alias: membership.alias,
      member_count: memberCount,
      capacity: membership.capacity,
      unread_count: await countUnread(db, { ...membership, memberCount }),
    });
  }
  return { rooms };
}

export async function handleLeaveTopic(input: unknown, meta: McpMeta) {
  const { topic } = inputSchemas.leave_topic.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const slug = await resolveSlug(db, topic);

  const membership = await leaveTopic(db, identity.subjectHash, slug);
  const topics = await listTopics(db);
  const displayName =
    membership?.topic.display_name ?? topics.find((entry) => entry.slug === slug)?.display_name ?? slug;

  return {
    left: true,
    topic_display_name: displayName,
    message: membership
      ? `Du hast deinen ${displayName}-Raum verlassen.`
      : `Du warst in ${displayName} in keinem Raum.`,
  };
}

export async function handleReportMessage(input: unknown, meta: McpMeta) {
  const { topic, message_id, reason } = inputSchemas.report_message.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const slug = await resolveSlug(db, topic);
  const settings = config();

  const membership = await requireMembership(db, identity.subjectHash, slug);
  const internalId = await decodeMessageId(message_id);
  if (internalId === null) throw roomError("MESSAGE_NOT_FOUND");

  // The reporter must actually have been allowed to see this message.
  const { messages } = await fetchVisibleMessages(db, membership, { limit: 1000 });
  const visible = messages.some((row) => row.id === internalId);
  if (!visible) throw roomError("MESSAGE_NOT_FOUND");

  await enforceRateLimit(db, identity.subjectHash, "report", WINDOWS.report(settings.reportLimitPerHour));
  await insertReport(db, internalId, membership.membershipId, reason);

  return {
    reported: true,
    message: "Danke. Die Nachricht wurde zur Prüfung gemeldet.",
  };
}
