/**
 * MCP handlers for personal rooms, the follow graph and notifications.
 * No login: the owner is always the pseudonymous subject from `_meta`.
 */
import { z } from "zod";

import { generateAlias, sanitizeAlias } from "./alias";
import { config, imageConfig, IMAGE_RETENTION } from "./config";
import { roomError } from "./errors";
import { resolveIdentity, type McpMeta } from "./identity";
import { encodeMessageId } from "./ids";
import { aliasesFor, listApprovedImages, signedUrl } from "./imagestore";
import {
  ensurePersonalRoom,
  findRoomByHandle,
  followRoom,
  followerCount,
  getNotificationSettings,
  isFollowing,
  isOwnerOnline,
  joinPersonalRoom,
  leavePersonalRoom,
  listFollowedRooms,
  listFollowers,
  listNotifications,
  markNotificationsRead,
  normalizeHandleInput,
  notifyFollowers,
  presentMembers,
  setNotificationSettings,
  unfollowRoom,
  updatePersonalRoom,
  type PersonalRoom,
} from "./personal";
import { enforceRateLimit, WINDOWS } from "./ratelimit";
import {
  countOnline,
  getCustomAlias,
  PRESENCE_WINDOW_SECONDS,
  touchPresence,
  type Db,
  getDb,
} from "./store";
import { validateMessage } from "./validation";

const handleSchema = z.object({ username: z.string().min(1) });

export const PERSONAL_NOTICE =
  "Persönliche Räume sind dauerhaft und öffentlich. Follower bleiben bestehen, auch wenn gerade niemand im Raum ist.";

/* -------------------------------- helpers -------------------------------- */

async function roomMessages(db: Db, room: PersonalRoom, selfMembershipId: string, limit = 20) {
  const { data, error } = await db
    .from("messages")
    .select("id, body, created_at, membership_id, memberships(alias)")
    .eq("room_id", room.roomId)
    .gt("expires_at", new Date().toISOString())
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw roomError("INTERNAL_ERROR");

  const rows = ((data ?? []) as any[]).reverse();
  return Promise.all(
    rows.map(async (row) => ({
      id: await encodeMessageId(row.id),
      alias: row.memberships?.alias ?? "Unbekannt",
      text: row.body as string,
      created_at: new Date(row.created_at).toISOString(),
      is_self: row.membership_id === selfMembershipId,
      is_owner: false,
    })),
  );
}

async function roomImages(db: Db, room: PersonalRoom) {
  const rows = await listApprovedImages(db, room.roomId, IMAGE_RETENTION);
  const aliases = await aliasesFor(
    db,
    rows.map((row) => row.sender_membership_id),
  );
  const ttl = imageConfig().signedUrlTtlSeconds;
  return Promise.all(
    rows.map(async (row) => ({
      alias: aliases[row.sender_membership_id] ?? "Unbekannt",
      alt_text: row.alt_text ?? "",
      created_at: new Date(row.created_at).toISOString(),
      url: (await signedUrl(db, row.storage_path, ttl)) ?? "",
    })),
  );
}

async function counters(db: Db, room: PersonalRoom) {
  const followers = await followerCount(db, room.roomId);
  const here = await countOnline(db, room.roomId);
  return {
    followers,
    people_here_now: here,
    presence_window_seconds: PRESENCE_WINDOW_SECONDS,
    presence_checked_at: new Date().toISOString(),
    headline: `${followers} followers · ${here} people here now`,
  };
}

const DISPLAY_INSTRUCTION =
  "Zeige zuerst Raumname und die Zeile «X followers · Y people here now», dann die Nachrichten mit Alias und alle Bilder als Markdown ![alt_text](url) in derselben Antwort.";

/* ------------------------------- own room -------------------------------- */

export async function handleMyRoom(_input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);

  const room = await ensurePersonalRoom(db, identity.subjectHash);
  const membership = await joinPersonalRoom(db, room, identity.subjectHash);
  const stats = await counters(db, room);

  return {
    room: {
      handle: room.handle,
      room_name: room.roomName,
      description: room.description ?? "",
      owner_alias: room.ownerAlias,
      is_owner: true,
      created_at: room.createdAt,
      ...stats,
    },
    people_here: await presentMembers(db, room.roomId),
    followers: await listFollowers(db, room.roomId),
    activity: await listNotifications(db, identity.subjectHash, { limit: 10 }),
    messages: await roomMessages(db, room, membership.membershipId),
    images: await roomImages(db, room),
    notification_settings: await getNotificationSettings(db, identity.subjectHash),
    dashboard_message: `${stats.followers} followers in your room · ${stats.people_here_now} people currently in your room`,
    display_instruction: DISPLAY_INSTRUCTION,
    notice: PERSONAL_NOTICE,
  };
}

export async function handleUpdateMyRoom(input: unknown, meta: McpMeta) {
  const parsed = z
    .object({ room_name: z.string().optional(), description: z.string().optional() })
    .parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);
  await ensurePersonalRoom(db, identity.subjectHash);

  const updated = await updatePersonalRoom(db, identity.subjectHash, parsed);
  return {
    handle: updated.handle,
    room_name: updated.room_name,
    description: updated.description ?? "",
    message: `Dein Raum heisst jetzt «${updated.room_name}».`,
  };
}

/* ------------------------------ visitor view ------------------------------ */

async function requirePublicRoom(db: Db, username: unknown): Promise<PersonalRoom> {
  const handle = normalizeHandleInput(username);
  const room = await findRoomByHandle(db, handle);
  if (!room) {
    throw roomError("NOT_FOUND", `Ich finde keinen Raum von @${handle}.`);
  }
  return room;
}

export async function handleOpenRoom(input: unknown, meta: McpMeta) {
  const { username } = handleSchema.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);

  const room = await requirePublicRoom(db, username);
  const isOwner = room.ownerSubjectHash === identity.subjectHash;
  const membership = await joinPersonalRoom(db, room, identity.subjectHash);
  if (!isOwner) {
    const { trackEvent } = await import("./personal");
    await trackEvent(db, room, "room_visit", identity.subjectHash);
  }
  const stats = await counters(db, room);

  return {
    room: {
      handle: room.handle,
      room_name: room.roomName,
      description: room.description ?? "",
      owner_alias: room.ownerAlias,
      owner_online: await isOwnerOnline(db, room),
      is_owner: isOwner,
      ...stats,
    },
    is_following: isOwner ? false : await isFollowing(db, room.roomId, identity.subjectHash),
    can_follow: !isOwner,
    follow_button: isOwner
      ? null
      : (await isFollowing(db, room.roomId, identity.subjectHash))
        ? "Following"
        : "Follow Room",
    joined_now: membership.joinedNow,
    people_here: await presentMembers(db, room.roomId),
    messages: await roomMessages(db, room, membership.membershipId),
    images: await roomImages(db, room),
    display_instruction: DISPLAY_INSTRUCTION,
    notice: PERSONAL_NOTICE,
  };
}

export async function handleLeaveRoom(input: unknown, meta: McpMeta) {
  const { username } = handleSchema.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const room = await requirePublicRoom(db, username);
  const left = await leavePersonalRoom(db, room.roomId, identity.subjectHash);
  const stats = await counters(db, room);
  return {
    left,
    ...stats,
    message: left
      ? `Du hast «${room.roomName}» verlassen. Du folgst dem Raum weiterhin, falls du ihm folgst — die Follower-Zahl ändert sich dadurch nicht.`
      : `Du warst nicht in «${room.roomName}».`,
  };
}

export async function handleSendRoomMessage(input: unknown, meta: McpMeta) {
  const { username, text } = z
    .object({ username: z.string().min(1), text: z.string() })
    .parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);

  const room = await requirePublicRoom(db, username);
  const membership = await joinPersonalRoom(db, room, identity.subjectHash);
  const settings = config();
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

  const now = new Date();
  const { error } = await db.from("messages").insert({
    room_id: room.roomId,
    membership_id: membership.membershipId,
    body,
    created_at: now.toISOString(),
    expires_at: new Date(
      now.getTime() + settings.messageRetentionHours * 3600 * 1000,
    ).toISOString(),
  });
  if (error) throw roomError("INTERNAL_ERROR");

  // Followers only hear from the room owner, never from every visitor.
  let notified = 0;
  if (room.ownerSubjectHash === identity.subjectHash) {
    const { count } = await db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.roomId)
      .gte("created_at", new Date(now.getTime() - 60 * 60 * 1000).toISOString());
    const type = (count ?? 0) <= 1 ? "new_conversation" : "public_message";
    notified = await notifyFollowers(
      db,
      room,
      type,
      type === "new_conversation"
        ? `${room.ownerAlias} started a new conversation in ${room.roomName}.`
        : `${room.ownerAlias} posted in ${room.roomName}.`,
    );
  }

  const stats = await counters(db, room);
  return {
    sent: true,
    room: {
      handle: room.handle,
      room_name: room.roomName,
      owner_alias: room.ownerAlias,
      ...stats,
    },
    followers_notified: notified,
    recent_messages: await roomMessages(db, room, membership.membershipId),
    images: await roomImages(db, room),
    display_instruction: DISPLAY_INSTRUCTION,
    notice: PERSONAL_NOTICE,
  };
}

/* --------------------------------- follow --------------------------------- */

export async function handleFollowRoom(input: unknown, meta: McpMeta) {
  const { username } = handleSchema.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);

  const room = await requirePublicRoom(db, username);
  const result = await followRoom(db, room, identity.subjectHash);
  const here = await countOnline(db, room.roomId);

  return {
    following: true,
    button: "Following",
    handle: room.handle,
    room_name: room.roomName,
    followers: result.followers,
    people_here_now: here,
    headline: `${result.followers} followers · ${here} people here now`,
    message: result.already
      ? `Du folgst «${room.roomName}» bereits.`
      : `Du folgst jetzt «${room.roomName}».`,
  };
}

export async function handleUnfollowRoom(input: unknown, meta: McpMeta) {
  const { username } = handleSchema.parse(input);
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);

  const room = await requirePublicRoom(db, username);
  const result = await unfollowRoom(db, room, identity.subjectHash);
  const here = await countOnline(db, room.roomId);

  return {
    following: false,
    button: "Follow Room",
    handle: room.handle,
    room_name: room.roomName,
    followers: result.followers,
    people_here_now: here,
    headline: `${result.followers} followers · ${here} people here now`,
    message: `Du folgst «${room.roomName}» nicht mehr.`,
  };
}

export async function handleListFollowing(_input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);
  const rooms = await listFollowedRooms(db, identity.subjectHash);
  return {
    rooms,
    message: rooms.length
      ? `Du folgst ${rooms.length} Raum/Räumen.`
      : "Du folgst noch keinem Raum. Sag «@rooms follow @name».",
  };
}

/* ------------------------------ notifications ----------------------------- */

export async function handleRoomNotifications(input: unknown, meta: McpMeta) {
  const { only_unread, mark_read } = z
    .object({ only_unread: z.boolean().optional(), mark_read: z.boolean().optional() })
    .parse(input ?? {});
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);

  const notifications = await listNotifications(db, identity.subjectHash, {
    onlyUnread: only_unread ?? false,
  });
  if (mark_read) await markNotificationsRead(db, identity.subjectHash);

  return {
    notifications,
    unread_count: notifications.filter((entry) => !entry.read).length,
    settings: await getNotificationSettings(db, identity.subjectHash),
    message: notifications.length
      ? `${notifications.length} Meldung(en).`
      : "Keine neuen Meldungen.",
  };
}

export async function handleNotificationSettings(input: unknown, meta: McpMeta) {
  const patch = z
    .object({
      new_conversation: z.boolean().optional(),
      public_message: z.boolean().optional(),
      live_event: z.boolean().optional(),
      new_follower: z.boolean().optional(),
    })
    .parse(input ?? {});
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);

  const settings = Object.keys(patch).length
    ? await setNotificationSettings(db, identity.subjectHash, patch)
    : await getNotificationSettings(db, identity.subjectHash);

  return {
    settings,
    message:
      "Benachrichtigungen: neues Gespräch, öffentliche Nachricht, Live-Gespräch und neue Follower lassen sich einzeln ein- und ausschalten.",
  };
}

/** Used by set_alias so the personal room follows the new display name. */
export async function personalAliasFallback(db: Db, subjectHash: string) {
  return (await getCustomAlias(db, subjectHash)) ?? generateAlias(`${subjectHash}:personal`);
}

export { sanitizeAlias };

/* ---------------------------- anonymous read path -------------------------- */

/**
 * Read-only view of a public personal room for signed-out callers.
 * Performs no joins, no presence writes and no analytics tracking.
 */
export async function publicRoomView(db: Db, username: unknown) {
  const room = await requirePublicRoom(db, username);
  const stats = await counters(db, room);
  return {
    room: {
      handle: room.handle,
      room_name: room.roomName,
      description: room.description ?? "",
      owner_alias: room.ownerAlias,
      owner_online: await isOwnerOnline(db, room),
      is_owner: false,
      ...stats,
    },
    is_following: false,
    can_follow: false,
    authenticated: false,
    joined_now: false,
    people_here: await presentMembers(db, room.roomId),
    messages: await roomMessages(db, room, ""),
    images: await roomImages(db, room),
    display_instruction: DISPLAY_INSTRUCTION,
    notice: PERSONAL_NOTICE,
    sign_in_hint:
      "Nur Lesen: Zum Schreiben, Folgen oder Liken muss sich die Person bei @room anmelden (Verbinden in ChatGPT).",
  };
}
