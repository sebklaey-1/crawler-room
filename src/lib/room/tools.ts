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
import { config, imageConfig, IMAGE_RETENTION } from "./config";
import { bytesToBase64, randomId } from "./crypto";
import { roomError } from "./errors";
import { resolveIdentity, type McpMeta } from "./identity";
import { decodeImageId, decodeMessageId, encodeImageId, encodeMessageId, idKind } from "./ids";
import { ALLOWED_MIME } from "./images";
import {
  aliasesFor,
  createImageRow,
  downloadObject,
  enforceImageRetention,
  findDuplicate,
  getImageRow,
  listApprovedImages,
  listOwnUnpublishedImages,
  removeStorageObjects,
  updateImageRow,
  type ImageRow,
} from "./imagestore";
import { issueToken, subjectFingerprint, verifyToken } from "./tokens";
import { enforceRateLimit, WINDOWS } from "./ratelimit";
import {
  countActiveMembers,
  countOnline,
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
  getCustomAlias,
  loadAliasMap,
  PRESENCE_WINDOW_SECONDS,
  roomLabel,
  setSubjectAlias,
  touchPresence,
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
  create_image_upload: z
    .object({
      topic: z.string().min(1),
      mime_type: z.string().min(1),
      file_size: z.number().int().positive(),
    })
    .strict(),
  finalize_image_upload: z
    .object({
      topic: z.string().min(1),
      image_id: z.string().min(1),
      alt_text: z.string().optional(),
    })
    .strict(),
  submit_image_review: z
    .object({
      topic: z.string().min(1),
      image_id: z.string().min(1),
      review_token: z.string().min(1),
      decision: z.enum(["approved", "rejected"]),
      category: z.string().optional(),
      alt_text: z.string().optional(),
      note: z.string().optional(),
    })
    .strict(),
  get_image: z.object({ topic: z.string().min(1), image_id: z.string().min(1) }).strict(),
  set_alias: z.object({ alias: z.string().min(1).max(64) }).strict(),
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

async function roomPayload(db: Db, membership: MembershipContext) {
  const onlineNow = await countOnline(db, membership.roomId);
  return {
    label: roomLabel(membership.topic.display_name, membership.roomNumber),
    member_count: membership.memberCount,
    capacity: membership.capacity,
    online_now: onlineNow,
    presence_window_seconds: PRESENCE_WINDOW_SECONDS,
    presence_checked_at: new Date().toISOString(),
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
  await touchPresence(db, identity.subjectHash);
  const slug = await resolveSlug(db, topic);
  const settings = config();

  const existing = await getActiveMembership(db, identity.subjectHash, slug);
  if (!existing) {
    await enforceRateLimit(db, identity.subjectHash, "join", WINDOWS.join(settings.joinLimitPerHour));
  }

  const desiredAlias =
    sanitizeAlias(alias) ??
    (await getCustomAlias(db, identity.subjectHash)) ??
    generateAlias(`${identity.subjectHash}:${slug}`);
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
    room: await roomPayload(db, membership),
    membership: { alias: membership.alias, joined_now: membership.joinedNow },
    messages: await serializeMessages(messages, membership),
    ...(await roomImages(db, membership)),
    unread_count: unread,
    notice: RETENTION_NOTICE,
  };
}

export async function handleSendMessage(input: unknown, meta: McpMeta) {
  const { topic, text } = inputSchemas.send_message.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);
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

  // Full recent conversation of the room so the assistant can read it back
  // immediately in the same reply.
  const { messages: recent } = await fetchVisibleMessages(db, membership, {
    afterId: null,
    limit: 20,
  });

  const lastId = messages.length ? messages[messages.length - 1]!.id : sent.id;
  await updateReadCursor(db, membership.membershipId, Math.max(lastId, sent.id));

  return {
    sent: true,
    topic: { slug: membership.topic.slug, display_name: membership.topic.display_name },
    room: await roomPayload(db, membership),
    sent_message: {
      id: await encodeMessageId(sent.id),
      alias: membership.alias,
      text: sent.body,
      created_at: new Date(sent.created_at).toISOString(),
      is_self: true,
    },
    new_messages: await serializeMessages(others, membership),
    recent_messages: await serializeMessages(
      recent.filter((row) => row.id !== sent.id),
      membership,
    ),
    display_instruction:
      "Gib in derselben Antwort die Nachrichten aus recent_messages als Liste mit Alias wieder, damit die Person sofort sieht, was im Raum geschrieben wurde. Neue Nachrichten (new_messages) zuerst hervorheben. Sind keine vorhanden, sage kurz, dass es noch still ist.",
    ...(await roomImages(db, membership)),
    unread_count: 0,
    notice: RETENTION_NOTICE,
  };
}


export async function handleReadMessages(input: unknown, meta: McpMeta) {
  const { topic, limit } = inputSchemas.read_messages.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);
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
    room: await roomPayload(db, membership),
    messages: await serializeMessages(messages, membership),
    ...(await roomImages(db, membership)),
    unread_count: unread,
    has_more: hasMore,
    notice: RETENTION_NOTICE,
  };
}

export async function handleMyRooms(_input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);
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
    const memberCount = await countActiveMembers(db, membership.roomId);

    rooms.push({
      topic_slug: membership.topic.slug,
      topic_display_name: membership.topic.display_name,
      room_label: roomLabel(membership.topic.display_name, membership.roomNumber),
      alias: membership.alias,
      member_count: memberCount,
      online_now: await countOnline(db, membership.roomId),
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
  await touchPresence(db, identity.subjectHash);
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
  await touchPresence(db, identity.subjectHash);
  const slug = await resolveSlug(db, topic);
  const settings = config();

  const membership = await requireMembership(db, identity.subjectHash, slug);
  const kind = idKind(message_id);

  if (kind === "image") {
    const imageId = await decodeImageId(message_id);
    if (imageId === null) throw roomError("IMAGE_NOT_FOUND");
    const row = await getImageRow(db, imageId);
    if (!row || row.room_id !== membership.roomId || row.moderation_status !== "approved") {
      throw roomError("IMAGE_NOT_FOUND");
    }
    await enforceRateLimit(db, identity.subjectHash, "report", WINDOWS.report(settings.reportLimitPerHour));
    await insertReport(db, { imageMessageId: imageId }, membership.membershipId, reason);
    return { reported: true, message: "Danke. Das Bild wurde zur Prüfung gemeldet." };
  }

  const internalId = await decodeMessageId(message_id);
  if (internalId === null) throw roomError("MESSAGE_NOT_FOUND");

  // The reporter must actually have been allowed to see this message.
  const { messages } = await fetchVisibleMessages(db, membership, { limit: 1000 });
  const visible = messages.some((row) => row.id === internalId);
  if (!visible) throw roomError("MESSAGE_NOT_FOUND");

  await enforceRateLimit(db, identity.subjectHash, "report", WINDOWS.report(settings.reportLimitPerHour));
  await insertReport(db, { messageId: internalId }, membership.membershipId, reason);

  return {
    reported: true,
    message: "Danke. Die Nachricht wurde zur Prüfung gemeldet.",
  };
}

/* ------------------------------ image tools ------------------------------ */

const SAFETY_RULES = [
  "sexual content or nudity",
  "any sexualized depiction of minors",
  "graphic violence or gore",
  "hate symbols or extremist propaganda",
  "harassment or degrading targeted content",
  "illegal content",
  "instructions promoting dangerous wrongdoing",
  "clearly exposed sensitive personal information (documents, addresses, ID cards)",
  "spam, scams or malicious QR codes",
];

const REVIEW_INSTRUCTIONS =
  "Look at the attached image yourself and decide. Approve normal artwork, photography, illustrations and creative work — a difficult political, historical or artistic subject alone is NOT a reason to reject. Reject only on a clear violation of the listed rules. Then call submit_image_review with the review_token, your decision and a short neutral alt text. The image stays invisible to everyone else until you approve it.";

export const RETENTION_NOTICE =
  "Temporärer Raum: Pro Raum werden nur die neuesten 7 Textnachrichten und 3 Bilder gespeichert. Ältere Inhalte werden automatisch und dauerhaft gelöscht.";

function fileExtension(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

async function serializeImages(
  db: Db,
  rows: ImageRow[],
  membership: MembershipContext,
) {
  const aliases = await aliasesFor(db, rows.map((row) => row.sender_membership_id));
  return Promise.all(
    rows.map(async (row) => ({
      id: await encodeImageId(row.id),
      alias: aliases[row.sender_membership_id] ?? "Unbekannt",
      created_at: new Date(row.created_at).toISOString(),
      alt_text: row.alt_text ?? "",
      width: row.width ?? 0,
      height: row.height ?? 0,
      status: row.moderation_status,
      is_self: row.sender_membership_id === membership.membershipId,
      note:
        row.moderation_status === "approved"
          ? "Use get_image with this id to display the image."
          : row.moderation_status === "pending"
            ? "Bild wird geprüft … (nur für dich sichtbar)"
            : "Bild abgelehnt (nur für dich sichtbar).",
    })),
  );
}

/** Approved images of the room plus the caller's own pending/rejected uploads. */
async function roomImages(db: Db, membership: MembershipContext) {
  const approved = await listApprovedImages(db, membership.roomId, IMAGE_RETENTION);
  const own = await listOwnUnpublishedImages(db, membership.roomId, membership.membershipId);
  return {
    images: await serializeImages(db, approved, membership),
    my_pending_images: await serializeImages(db, own, membership),
  };
}

export async function handleCreateImageUpload(input: unknown, meta: McpMeta) {
  const { topic, mime_type, file_size } = inputSchemas.create_image_upload.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);
  const slug = await resolveSlug(db, topic);
  const membership = await requireMembership(db, identity.subjectHash, slug);
  const settings = imageConfig();

  if (!ALLOWED_MIME.includes(mime_type as any)) throw roomError("IMAGE_TYPE_UNSUPPORTED");
  if (file_size <= 0 || file_size > settings.maxImageBytes) throw roomError("IMAGE_TOO_LARGE");

  await enforceRateLimit(db, identity.subjectHash, "upload", [
    { seconds: 3600, max: settings.uploadLimitPerHour },
  ]);

  const path = `${membership.roomId}/${randomId(16)}.${fileExtension(mime_type)}`;
  const row = await createImageRow(db, membership, path, mime_type);
  const token = await issueToken(
    "upload",
    row.id,
    identity.subjectHash,
    settings.uploadTokenTtlSeconds,
    randomId(8),
  );

  return {
    image_id: await encodeImageId(row.id),
    upload: {
      url: `${uploadBaseUrl(meta)}/api/public/room/upload`,
      method: "POST",
      token,
      token_header: "x-room-upload-token",
      content_type_header: mime_type,
      body: "raw image bytes",
      expires_in_seconds: settings.uploadTokenTtlSeconds,
    },
    status: "awaiting_upload",
    max_bytes: settings.maxImageBytes,
    notice: RETENTION_NOTICE,
    next_step: "After uploading the bytes, call finalize_image_upload with this image_id.",
  };
}

export async function handleFinalizeImageUpload(input: unknown, meta: McpMeta) {
  const { topic, image_id, alt_text } = inputSchemas.finalize_image_upload.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);
  const slug = await resolveSlug(db, topic);
  const membership = await requireMembership(db, identity.subjectHash, slug);
  const settings = imageConfig();

  const internalId = await decodeImageId(image_id);
  if (internalId === null) throw roomError("IMAGE_NOT_FOUND");
  const row = await getImageRow(db, internalId);
  if (!row || row.sender_membership_id !== membership.membershipId) throw roomError("IMAGE_NOT_FOUND");
  if (!row.uploaded) throw roomError("IMAGE_NOT_UPLOADED");
  if (row.moderation_status === "approved") {
    return {
      image_id,
      status: "approved",
      message: "Bild genehmigt",
      notice: RETENTION_NOTICE,
      ...(await roomImages(db, membership)),
    };
  }
  if (row.moderation_status !== "pending") throw roomError("IMAGE_REJECTED");

  if (typeof alt_text === "string" && alt_text.trim()) {
    await updateImageRow(db, row.id, { alt_text: alt_text.trim().slice(0, 300) });
  }

  const bytes = await downloadObject(db, row.storage_path);
  if (!bytes) throw roomError("IMAGE_NOT_FOUND");

  const reviewToken = await issueToken(
    "review",
    row.id,
    identity.subjectHash,
    settings.reviewTokenTtlSeconds,
    randomId(8),
  );

  return {
    image_id,
    status: "pending",
    message: "Bild wird geprüft …",
    review_required: true,
    review_token: reviewToken,
    safety_rules: SAFETY_RULES,
    instructions: REVIEW_INSTRUCTIONS,
    notice: RETENTION_NOTICE,
    _content: [
      { type: "text", text: `Bild wird geprüft … Prüfe dieses Bild gegen die Raumregeln.\n${REVIEW_INSTRUCTIONS}` },
      { type: "image", data: bytesToBase64(bytes), mimeType: row.mime_type },
    ],
  };
}

export async function handleSubmitImageReview(input: unknown, meta: McpMeta) {
  const { topic, image_id, review_token, decision, category, alt_text } =
    inputSchemas.submit_image_review.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);
  const slug = await resolveSlug(db, topic);
  const membership = await requireMembership(db, identity.subjectHash, slug);

  const internalId = await decodeImageId(image_id);
  if (internalId === null) throw roomError("IMAGE_NOT_FOUND");

  const claims = await verifyToken(review_token, "review");
  if (
    !claims ||
    claims.imageId !== internalId ||
    claims.subjectHash !== subjectFingerprint(identity.subjectHash)
  ) {
    throw roomError("REVIEW_INVALID");
  }

  const row = await getImageRow(db, internalId);
  if (!row || row.sender_membership_id !== membership.membershipId) throw roomError("IMAGE_NOT_FOUND");
  if (row.moderation_status !== "pending") throw roomError("REVIEW_INVALID");

  if (decision === "rejected") {
    await updateImageRow(db, row.id, {
      moderation_status: "rejected",
      moderation_reason: category ?? "safety_rule_violation",
    });
    // The file goes immediately; the row is purged by the cleanup job.
    await removeStorageObjects(db, [row.storage_path]);
    logModeration(row.id, "rejected", category ?? "safety_rule_violation");
    return {
      image_id,
      status: "rejected",
      message: "Bild abgelehnt. Es verstösst gegen die Raumregeln und wurde nicht veröffentlicht.",
      visible_to_others: false,
      notice: RETENTION_NOTICE,
      ...(await roomImages(db, membership)),
    };
  }

  if (row.checksum && (await findDuplicate(db, row.room_id, row.checksum, row.id))) {
    await updateImageRow(db, row.id, { moderation_status: "failed", moderation_reason: "duplicate" });
    await removeStorageObjects(db, [row.storage_path]);
    throw roomError("IMAGE_DUPLICATE");
  }

  await updateImageRow(db, row.id, {
    moderation_status: "approved",
    approved_at: new Date().toISOString(),
    moderation_reason: null,
    ...(typeof alt_text === "string" && alt_text.trim()
      ? { alt_text: alt_text.trim().slice(0, 300) }
      : {}),
  });
  logModeration(row.id, "approved", null);

  // Rolling retention: a room keeps only its newest 3 approved images.
  await enforceImageRetention(db, membership.roomId);

  return {
    image_id,
    status: "approved",
    message: "Bild genehmigt und im Raum veröffentlicht.",
    visible_to_others: true,
    notice: RETENTION_NOTICE,
    ...(await roomImages(db, membership)),
  };
}

export async function handleGetImage(input: unknown, meta: McpMeta) {
  const { topic, image_id } = inputSchemas.get_image.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);
  const slug = await resolveSlug(db, topic);
  const membership = await requireMembership(db, identity.subjectHash, slug);

  const internalId = await decodeImageId(image_id);
  if (internalId === null) throw roomError("IMAGE_NOT_FOUND");
  const row = await getImageRow(db, internalId);
  // Cross-room access is impossible: the image must live in the caller's room.
  if (!row || row.room_id !== membership.roomId) throw roomError("IMAGE_NOT_FOUND");

  if (row.moderation_status !== "approved") {
    const own = row.sender_membership_id === membership.membershipId;
    if (!own) throw roomError("IMAGE_NOT_FOUND");
    throw roomError(row.moderation_status === "pending" ? "IMAGE_PENDING_REVIEW" : "IMAGE_REJECTED");
  }

  const bytes = await downloadObject(db, row.storage_path);
  if (!bytes) throw roomError("IMAGE_NOT_FOUND");
  const aliases = await aliasesFor(db, [row.sender_membership_id]);

  return {
    image_id,
    alias: aliases[row.sender_membership_id] ?? "Unbekannt",
    created_at: new Date(row.created_at).toISOString(),
    alt_text: row.alt_text ?? "",
    mime_type: row.mime_type,
    width: row.width ?? 0,
    height: row.height ?? 0,
    notice: RETENTION_NOTICE,
    _content: [
      {
        type: "text",
        text: `${aliases[row.sender_membership_id] ?? "Unbekannt"} · ${row.alt_text ?? "Bild"}`,
      },
      { type: "image", data: bytesToBase64(bytes), mimeType: row.mime_type },
    ],
  };
}

function logModeration(imageId: number, decision: string, reason: string | null) {
  // Decision log without any personal data or content.
  console.log(JSON.stringify({ service: "room-mcp", moderation: { imageId, decision, reason } }));
}

function uploadBaseUrl(meta: McpMeta): string {
  const settings = config();
  if (settings.publicMcpBaseUrl) return settings.publicMcpBaseUrl.replace(/\/$/, "");
  const origin = meta && typeof meta["room/origin"] === "string" ? (meta["room/origin"] as string) : "";
  return origin.replace(/\/$/, "");
}


/* ------------------------------ display name ------------------------------ */

/**
 * Sets or changes the person's own display name. The name is stored on the
 * pseudonymous identity and applied to every active room membership, so other
 * people immediately see the new name. Identity itself never changes.
 */
export async function handleSetAlias(input: unknown, meta: McpMeta) {
  const { alias } = inputSchemas.set_alias.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);

  const clean = sanitizeAlias(alias);
  if (!clean) {
    throw roomError(
      "INVALID_INPUT",
      "Dieser Name enthält keine verwendbaren Zeichen. Bitte einen einfachen Namen wählen (Buchstaben, Zahlen, Leerzeichen).",
    );
  }

  const { ensureAccount } = await import("./entitlements");
  await ensureAccount(db, identity.subjectHash);
  const previous = await getCustomAlias(db, identity.subjectHash);
  const result = await setSubjectAlias(db, identity.subjectHash, clean);

  return {
    alias: result.alias,
    previous_alias: previous,
    rooms_updated: result.roomsUpdated,
    message: `Dein Name ist jetzt «${result.alias}». Er gilt in ${result.roomsUpdated} aktiven Raum/Räumen und für neue Räume. Du kannst ihn jederzeit wieder ändern.`,
  };
}

/** Current display name plus a short how-to for changing it. */
export async function handleGetAlias(_input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);
  const alias = await getCustomAlias(db, identity.subjectHash);
  return {
    alias,
    has_custom_alias: Boolean(alias),
    message: alias
      ? `Dein Name ist «${alias}». Sag einfach «nenn mich …», um ihn zu ändern.`
      : "Du hast noch keinen eigenen Namen gewählt — in jedem Raum bekommst du einen zufälligen Anzeigenamen. Sag «nenn mich …», um einen eigenen Namen zu setzen.",
  };
}
