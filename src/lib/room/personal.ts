/**
 * Personal rooms and the follow graph.
 *
 * Every pseudonymous identity owns exactly one permanent personal room named
 * after its display name ("Sebastian's Room"). No login is involved: the
 * owner is the `subject_hash` derived from the MCP request metadata.
 *
 * Followers (permanent) and presence (live) are strictly separate:
 * `room_followers` is never touched by presence updates.
 */
import { embedded, type EmbeddedShapes } from "./dbtypes";
import { generateAlias, sanitizeAlias } from "./alias";
import { roomError } from "./errors";
import { countOnline, getCustomAlias, PRESENCE_WINDOW_SECONDS, type Db } from "./store";

export type NotificationType =
  "new_conversation" | "public_message" | "live_event" | "new_follower";

export interface PersonalRoom {
  roomId: string;
  handle: string;
  roomName: string;
  description: string | null;
  ownerSubjectHash: string;
  ownerAlias: string;
  createdAt: string;
}

/* --------------------------------- handles -------------------------------- */

/**
 * Handles are one single global namespace (`user_rooms.handle` plus every old
 * handle kept in `handle_redirects`). The canonical form is lowercase ASCII
 * `[a-z0-9_]{3,30}`; case and surrounding whitespace never create a second
 * name. The database is the authority — see `public.normalize_handle`.
 */
export const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

/** Canonical form of a handle, or null when the input is not a valid handle. */
export function canonicalHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.normalize("NFKC").trim().replace(/^@+/, "").toLowerCase();
  return HANDLE_PATTERN.test(value) ? value : null;
}

/**
 * Derives a *base* handle from an arbitrary display name. Only used to seed
 * automatic first-time assignment and suggestions — an explicitly chosen
 * handle is never silently slugified.
 */
export function slugifyHandle(alias: string): string {
  const base = alias
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  return base.length >= 3 ? base : "member";
}

/** Strips a leading "@" and normalises a handle the user typed; never slugifies. */
export function normalizeHandleInput(raw: unknown): string {
  const handle = canonicalHandle(raw);
  if (!handle) {
    throw roomError(
      "INVALID_INPUT",
      "Handles bestehen aus 3–30 Zeichen: Kleinbuchstaben, Zahlen und Unterstriche, keine Leerzeichen.",
    );
  }
  return handle;
}

/** True when a Postgres error signals a lost handle/alias claim race. */
export function isClaimConflict(error: unknown): boolean {
  const value = error as { code?: string; message?: string } | null;
  if (!value) return false;
  return value.code === "23505" || /ALIAS_TAKEN/.test(value.message ?? "");
}

/* ------------------------------ personal room ----------------------------- */

export function personalRoomName(alias: string): string {
  const trimmed = alias.trim();
  return /s$/i.test(trimmed) ? `${trimmed}' Room` : `${trimmed}'s Room`;
}

/** Idempotent: returns the person's permanent room, creating it on first use. */
export async function ensurePersonalRoom(db: Db, subjectHash: string): Promise<PersonalRoom> {
  const alias = (await getCustomAlias(db, subjectHash)) ?? generateAlias(`${subjectHash}:personal`);
  const handle = await uniqueHandle(db, subjectHash, slugifyHandle(alias));

  const { data, error } = await db.rpc("get_or_create_personal_room", {
    p_subject_hash: subjectHash,
    p_handle: handle,
    p_room_name: personalRoomName(alias),
  });
  if (error) throw roomError("ROOM_UNAVAILABLE");
  const row = data as {
    room_id?: string;
    handle?: string;
    room_name?: string;
    description?: string | null;
    created_at?: string;
  } | null;
  if (!row?.room_id) throw roomError("ROOM_UNAVAILABLE");

  return {
    roomId: row.room_id,
    handle: row.handle ?? handle,
    roomName: row.room_name ?? personalRoomName(alias),
    description: row.description ?? null,
    ownerSubjectHash: subjectHash,
    ownerAlias: alias,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

/** Keeps handle and room name in sync after a display-name change. */
export async function syncPersonalRoomName(db: Db, subjectHash: string, alias: string) {
  const { data } = await db
    .from("user_rooms")
    .select("id, handle, room_name")
    .eq("owner_subject_hash", subjectHash)
    .maybeSingle();
  if (!data) return null;

  const handle = await uniqueHandle(db, subjectHash, slugifyHandle(alias));
  const roomName = personalRoomName(alias);
  await db.from("user_rooms").update({ handle, room_name: roomName }).eq("id", data.id);
  await db
    .from("rooms")
    .update({ title: roomName })
    .eq("id", (data as { room_id?: string | null }).room_id ?? undefined);
  return { handle, roomName };
}

export async function findRoomByHandle(db: Db, handle: string): Promise<PersonalRoom | null> {
  const { data, error } = await db
    .from("user_rooms")
    .select("room_id, handle, room_name, description, owner_subject_hash, created_at")
    .eq("handle", handle)
    .maybeSingle();
  if (error) throw roomError("INTERNAL_ERROR");
  if (!data) return null;

  const row = data;
  const ownerAlias = (await getCustomAlias(db, row.owner_subject_hash)) ?? row.room_name;
  return {
    roomId: row.room_id,
    handle: row.handle,
    roomName: row.room_name,
    description: row.description,
    ownerSubjectHash: row.owner_subject_hash,
    ownerAlias,
    createdAt: row.created_at,
  };
}

export async function updatePersonalRoom(
  db: Db,
  subjectHash: string,
  patch: { room_name?: string | null | undefined; description?: string | null | undefined },
) {
  const update: Record<string, unknown> = {};
  if (typeof patch.room_name === "string") {
    const clean = sanitizeAlias(patch.room_name);
    if (!clean) throw roomError("INVALID_INPUT");
    update["room_name"] = clean;
  }
  if (typeof patch.description === "string") {
    update["description"] = patch.description.trim().slice(0, 280);
  }
  if (!Object.keys(update).length) throw roomError("INVALID_INPUT");

  const { data, error } = await db
    .from("user_rooms")
    .update(update)
    .eq("owner_subject_hash", subjectHash)
    .select("room_id, handle, room_name, description")
    .maybeSingle();
  if (error) throw roomError("INTERNAL_ERROR");
  if (!data) throw roomError("NOT_FOUND");

  if (update["room_name"]) {
    await db.from("rooms").update({ title: update["room_name"] }).eq("id", data.room_id);
  }
  return data;
}

/* --------------------------------- presence -------------------------------- */

/** Joins (or rejoins) a personal room; capacity is effectively unlimited. */
export async function joinPersonalRoom(
  db: Db,
  room: PersonalRoom,
  subjectHash: string,
): Promise<{
  membershipId: string;
  alias: string;
  joinedAt: string;
  lastReadMessageId: number | null;
  joinedNow: boolean;
}> {
  const { data: existing } = await db
    .from("memberships")
    .select("id, alias, joined_at, last_read_message_id")
    .eq("room_id", room.roomId)
    .eq("subject_hash", subjectHash)
    .is("left_at", null)
    .maybeSingle();

  if (existing) {
    const row = existing;
    await db
      .from("memberships")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", row.id);
    return {
      membershipId: row.id,
      alias: row.alias,
      joinedAt: row.joined_at,
      lastReadMessageId: row.last_read_message_id,
      joinedNow: false,
    };
  }

  const alias =
    (await getCustomAlias(db, subjectHash)) ?? generateAlias(`${subjectHash}:${room.handle}`);
  const { data, error } = await db
    .from("memberships")
    .insert({
      room_id: room.roomId,
      topic_id: null,
      subject_hash: subjectHash,
      alias,
      role: subjectHash === room.ownerSubjectHash ? "owner" : "participant",
    })
    .select("id, alias, joined_at, last_read_message_id")
    .single();
  if (error || !data) throw roomError("ROOM_UNAVAILABLE");

  const row = data;
  return {
    membershipId: row.id,
    alias: row.alias,
    joinedAt: row.joined_at,
    lastReadMessageId: row.last_read_message_id,
    joinedNow: true,
  };
}

export async function leavePersonalRoom(db: Db, roomId: string, subjectHash: string) {
  const { data, error } = await db
    .from("memberships")
    .update({ left_at: new Date().toISOString() })
    .eq("room_id", roomId)
    .eq("subject_hash", subjectHash)
    .is("left_at", null)
    .select("id");
  if (error) throw roomError("INTERNAL_ERROR");
  return (data ?? []).length > 0;
}

/** People currently in the room (live), never the follower list. */
export async function presentMembers(db: Db, roomId: string, limit = 50) {
  const since = new Date(Date.now() - PRESENCE_WINDOW_SECONDS * 1000).toISOString();
  const { data, error } = await db
    .from("room_presence")
    .select("alias, joined_at, last_seen_at, presence_status, user_id")
    .eq("room_id", roomId)
    .gte("last_seen_at", since)
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (error) throw roomError("INTERNAL_ERROR");
  return (data ?? []).map((row) => ({
    alias: row.alias as string,
    joined_at: row.joined_at as string,
    last_seen_at: row.last_seen_at as string,
    presence_status: row.presence_status as string,
  }));
}

export async function isOwnerOnline(db: Db, room: PersonalRoom): Promise<boolean> {
  const since = new Date(Date.now() - PRESENCE_WINDOW_SECONDS * 1000).toISOString();
  const { count } = await db
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("room_id", room.roomId)
    .eq("subject_hash", room.ownerSubjectHash)
    .is("left_at", null)
    .gte("last_seen_at", since);
  return (count ?? 0) > 0;
}

export async function liveCount(db: Db, roomId: string): Promise<number> {
  return countOnline(db, roomId);
}

/* --------------------------------- follows -------------------------------- */

export async function followerCount(db: Db, roomId: string): Promise<number> {
  const { count, error } = await db
    .from("room_followers")
    .select("id", { count: "exact", head: true })
    .eq("room_id", roomId);
  if (error) throw roomError("INTERNAL_ERROR");
  return count ?? 0;
}

export async function isFollowing(db: Db, roomId: string, subjectHash: string): Promise<boolean> {
  const { data } = await db
    .from("room_followers")
    .select("id")
    .eq("room_id", roomId)
    .eq("follower_subject_hash", subjectHash)
    .maybeSingle();
  return Boolean(data);
}

export async function followRoom(db: Db, room: PersonalRoom, subjectHash: string) {
  if (room.ownerSubjectHash === subjectHash) {
    throw roomError("FORBIDDEN", "Du kannst deinem eigenen Raum nicht folgen.");
  }
  if (await isFollowing(db, room.roomId, subjectHash)) {
    return { already: true, followers: await followerCount(db, room.roomId) };
  }

  const { error } = await db
    .from("room_followers")
    .insert({ room_id: room.roomId, follower_subject_hash: subjectHash });
  // Unique constraint => already following (idempotent, never double counted).
  if (error && !String(error.code).startsWith("23")) throw roomError("INTERNAL_ERROR");

  const alias = (await getCustomAlias(db, subjectHash)) ?? generateAlias(`${subjectHash}:follow`);
  await notify(
    db,
    room.ownerSubjectHash,
    room.roomId,
    "new_follower",
    `${alias} started following your room.`,
  );
  await trackEvent(db, room, "follow", subjectHash);

  return { already: Boolean(error), followers: await followerCount(db, room.roomId) };
}

export async function unfollowRoom(db: Db, room: PersonalRoom, subjectHash: string) {
  const { error } = await db
    .from("room_followers")
    .delete()
    .eq("room_id", room.roomId)
    .eq("follower_subject_hash", subjectHash);
  if (error) throw roomError("INTERNAL_ERROR");
  await trackEvent(db, room, "unfollow", subjectHash);
  return { followers: await followerCount(db, room.roomId) };
}

/** Owner-only analytics counter; loaded lazily to avoid a circular import. */
export async function trackEvent(
  db: Db,
  room: PersonalRoom,
  type: "follow" | "unfollow" | "room_visit" | "message_view" | "image_view",
  actorHash: string,
) {
  const { recordEvent } = await import("./profile");
  await recordEvent(db, {
    roomId: room.roomId,
    ownerSubjectHash: room.ownerSubjectHash,
    type,
    actorHash,
  });
}

export async function listFollowers(db: Db, roomId: string, limit = 100) {
  const { data, error } = await db
    .from("room_followers")
    .select("follower_subject_hash, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw roomError("INTERNAL_ERROR");

  const rows = data ?? [];
  const out = [];
  for (const row of rows) {
    const alias =
      (await getCustomAlias(db, row.follower_subject_hash)) ??
      generateAlias(`${row.follower_subject_hash}:follow`);
    out.push({ alias, since: row.created_at as string });
  }
  return out;
}

/** Rooms this person follows. */
export async function listFollowedRooms(db: Db, subjectHash: string) {
  const { data, error } = await db
    .from("room_followers")
    .select("room_id, created_at, user_rooms!inner(handle, room_name, description)")
    .eq("follower_subject_hash", subjectHash)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return [];
  const out = [];
  for (const row of data ?? []) {
    out.push({
      handle: embedded<EmbeddedShapes["user_rooms"]>(row.user_rooms)?.handle as string,
      room_name: embedded<EmbeddedShapes["user_rooms"]>(row.user_rooms)?.room_name as string,
      description: embedded<EmbeddedShapes["user_rooms"]>(row.user_rooms)?.description ?? null,
      followers: await followerCount(db, row.room_id),
      people_here_now: await countOnline(db, row.room_id),
      following_since: row.created_at as string,
    });
  }
  return out;
}

/* ------------------------------ notifications ----------------------------- */

export interface NotificationSettings {
  new_conversation: boolean;
  public_message: boolean;
  live_event: boolean;
  new_follower: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  new_conversation: true,
  public_message: true,
  live_event: true,
  new_follower: true,
};

export async function getNotificationSettings(
  db: Db,
  subjectHash: string,
): Promise<NotificationSettings> {
  const { data } = await db
    .from("notification_settings")
    .select("new_conversation, public_message, live_event, new_follower")
    .eq("subject_hash", subjectHash)
    .maybeSingle();
  return { ...DEFAULT_SETTINGS, ...((data ?? {}) as Partial<NotificationSettings>) };
}

export async function setNotificationSettings(
  db: Db,
  subjectHash: string,
  patch: { [K in keyof NotificationSettings]?: boolean | undefined },
): Promise<NotificationSettings> {
  const current = await getNotificationSettings(db, subjectHash);
  const next: NotificationSettings = { ...current };
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof NotificationSettings>) {
    if (typeof patch[key] === "boolean") next[key] = patch[key] as boolean;
  }
  const { error } = await db
    .from("notification_settings")
    .upsert({ subject_hash: subjectHash, ...next }, { onConflict: "subject_hash" });
  if (error) throw roomError("INTERNAL_ERROR");
  return next;
}

async function notify(
  db: Db,
  recipient: string,
  roomId: string,
  type: NotificationType,
  message: string,
) {
  const settings = await getNotificationSettings(db, recipient);
  if (!settings[type]) return;
  await db.from("room_notifications").insert({
    recipient_subject_hash: recipient,
    room_id: roomId,
    notification_type: type,
    message,
  });
}

/** Fans a room event out to every follower who has that type enabled. */
export async function notifyFollowers(
  db: Db,
  room: PersonalRoom,
  type: NotificationType,
  message: string,
) {
  const { data } = await db
    .from("room_followers")
    .select("follower_subject_hash")
    .eq("room_id", room.roomId)
    .limit(5000);

  const rows = data ?? [];
  if (!rows.length) return 0;

  const allowed: string[] = [];
  for (const row of rows) {
    const settings = await getNotificationSettings(db, row.follower_subject_hash);
    if (settings[type]) allowed.push(row.follower_subject_hash);
  }
  if (!allowed.length) return 0;

  await db.from("room_notifications").insert(
    allowed.map((recipient) => ({
      recipient_subject_hash: recipient,
      room_id: room.roomId,
      notification_type: type,
      message,
    })),
  );
  return allowed.length;
}

export async function listNotifications(
  db: Db,
  subjectHash: string,
  options: { onlyUnread?: boolean; limit?: number } = {},
) {
  let query = db
    .from("room_notifications")
    .select("id, notification_type, message, read, created_at")
    .eq("recipient_subject_hash", subjectHash)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(options.limit ?? 20, 1), 50));
  if (options.onlyUnread) query = query.eq("read", false);

  const { data, error } = await query;
  if (error) throw roomError("INTERNAL_ERROR");
  return (data ?? []).map((row) => ({
    type: row.notification_type as string,
    message: row.message as string,
    read: Boolean(row.read),
    created_at: row.created_at as string,
  }));
}

export async function markNotificationsRead(db: Db, subjectHash: string) {
  await db
    .from("room_notifications")
    .update({ read: true })
    .eq("recipient_subject_hash", subjectHash)
    .eq("read", false);
}
