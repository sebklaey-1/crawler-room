/**
 * Public social profiles for personal rooms.
 *
 * A profile is NOT a second identity model: it is the existing pseudonymous
 * `subject_hash` plus its permanent personal room (`user_rooms`). All checks
 * happen server-side; only the owner may edit or read analytics.
 */
import { generateAlias, sanitizeAlias } from "./alias";
import { imageConfig, retentionCutoffIso } from "./config";
import { roomError } from "./errors";
import { SafeFetchError, fetchImageSafely } from "./ssrf";
import { sanitizeImage } from "./images";
import { removeStorageObjects, uploadObject } from "./imagestore";
import { publicProfileImageUrl } from "./imageurl";
import {
  canonicalHandle,
  ensurePersonalRoom,
  followerCount,
  isClaimConflict,
  isFollowing,
  liveCount,
  slugifyHandle,
  type PersonalRoom,
} from "./personal";
import {
  countOnline,
  getCustomAlias,
  PRESENCE_WINDOW_SECONDS,
  setSubjectAlias,
  type Db,
} from "./store";

export const BIO_MAX = 280;
export const LOCATION_MAX = 60;

/* --------------------------------- handles -------------------------------- */

const RESERVED_HANDLES = new Set([
  "admin",
  "administrator",
  "room",
  "rooms",
  "at_room",
  "support",
  "help",
  "about",
  "api",
  "mcp",
  "system",
  "moderator",
  "mod",
  "staff",
  "official",
  "security",
  "privacy",
  "terms",
  "health",
  "settings",
  "profile",
  "login",
  "signup",
  "null",
  "undefined",
  "me",
  "you",
  "everyone",
  "here",
  "all",
  "team",
  "sebklaey",
]);

const BLOCKED_FRAGMENTS = [
  "fuck",
  "shit",
  "bitch",
  "nigg",
  "cunt",
  "rape",
  "nazi",
  "hitler",
  "faggot",
  "whore",
  "arsch",
  "fotze",
  "hure",
  "wichser",
  "schlampe",
  "kinderporn",
  "cp_",
];

/**
 * Validates an explicitly chosen handle. Invalid input is rejected, never
 * silently slugified. Handles are one global namespace and case/trim variants
 * of the same handle are the same name.
 */
export function validateHandle(raw: unknown): string {
  const handle = canonicalHandle(raw);
  if (!handle) {
    throw roomError(
      "INVALID_INPUT",
      "Handles bestehen aus 3–30 Zeichen: Kleinbuchstaben, Zahlen und Unterstriche, keine Leerzeichen.",
    );
  }
  if (RESERVED_HANDLES.has(handle)) {
    throw roomError("INVALID_INPUT", `@${handle} ist reserviert. Bitte wähle ein anderes Handle.`);
  }
  if (BLOCKED_FRAGMENTS.some((fragment) => handle.includes(fragment))) {
    throw roomError("INVALID_INPUT", "Dieses Handle ist nicht erlaubt.");
  }
  return handle;
}

/**
 * UX pre-check only — the claim registry in the database is the authority and
 * rejects every colliding write, including races this check cannot see.
 */
export async function isHandleFree(db: Db, handle: string, subjectHash: string): Promise<boolean> {
  const normalized = canonicalHandle(handle);
  if (!normalized) return false;
  const { data, error } = await db
    .from("name_claims")
    .select("owner_subject_hash")
    .eq("kind", "handle")
    .eq("normalized", normalized)
    .maybeSingle();
  if (error) throw roomError("INTERNAL_ERROR");
  return !data || data.owner_subject_hash === subjectHash;
}

/** Up to three handles that are actually free right now. No IDs, no hashes. */
export async function suggestHandles(db: Db, base: string, subjectHash: string): Promise<string[]> {
  const root = slugifyHandle(base).slice(0, 24) || "member";
  const out: string[] = [];
  for (const suffix of ["", "_1", "_2", "_room", "_hq", String(new Date().getFullYear())]) {
    const candidate = `${root}${suffix}`.slice(0, 30);
    if (!canonicalHandle(candidate)) continue;
    try {
      validateHandle(candidate);
    } catch {
      continue;
    }
    if (await isHandleFree(db, candidate, subjectHash)) out.push(candidate);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Changes the handle atomically and keeps the old one as a redirect owned by
 * the same identity. A handle held by somebody else — current or as their old
 * redirect — is refused with `ALIAS_TAKEN`.
 */
export async function changeHandle(db: Db, subjectHash: string, desired: unknown) {
  const handle = validateHandle(desired);
  const room = await ensurePersonalRoom(db, subjectHash);
  if (room.handle === handle) return { handle, changed: false, old_handle: handle };

  const { data, error } = await db.rpc("change_personal_handle", {
    p_subject_hash: subjectHash,
    p_handle: handle,
  });
  if (error) {
    if (isClaimConflict(error)) throw roomError("ALIAS_TAKEN");
    throw roomError("INTERNAL_ERROR");
  }
  const result = data as { handle?: string; old_handle?: string; changed?: boolean } | null;
  if (!result?.handle) throw roomError("INTERNAL_ERROR");

  return {
    handle: result.handle,
    changed: Boolean(result.changed),
    old_handle: result.old_handle ?? room.handle,
  };
}

/* --------------------------------- profile -------------------------------- */

export interface ProfileRow extends PersonalRoom {
  bio: string | null;
  location: string | null;
  externalUrl: string | null;
  avatarPath: string | null;
  bannerPath: string | null;
  visibility: "public" | "private";
  showOnlineStatus: boolean;
  showFollowerCount: boolean;
  showLikes: boolean;
}

const PROFILE_COLUMNS =
  "room_id, handle, room_name, description, avatar_path, banner_path, location, external_url, profile_visibility, show_online_status, show_follower_count, show_likes, owner_subject_hash, created_at";

/** Raw `user_rooms` columns this module projects. */
interface UserRoomRow {
  room_id: string;
  handle: string;
  room_name: string;
  description?: string | null;
  avatar_path?: string | null;
  banner_path?: string | null;
  location?: string | null;
  external_url?: string | null;
  profile_visibility?: string | null;
  show_online_status?: boolean | null;
  show_follower_count?: boolean | null;
  show_likes?: boolean | null;
  owner_subject_hash: string;
  created_at: string;
}

function mapProfile(row: UserRoomRow, ownerAlias: string): ProfileRow {
  return {
    roomId: row.room_id,
    handle: row.handle,
    roomName: row.room_name,
    description: row.description ?? null,
    ownerSubjectHash: row.owner_subject_hash,
    ownerAlias,
    createdAt: row.created_at,
    bio: row.description ?? null,
    location: row.location ?? null,
    externalUrl: row.external_url ?? null,
    avatarPath: row.avatar_path ?? null,
    bannerPath: row.banner_path ?? null,
    visibility: (row.profile_visibility ?? "public") as "public" | "private",
    showOnlineStatus: row.show_online_status !== false,
    showFollowerCount: row.show_follower_count !== false,
    showLikes: row.show_likes !== false,
  };
}

async function loadByColumn(db: Db, column: string, value: string): Promise<ProfileRow | null> {
  const { data, error } = await db
    .from("user_rooms")
    .select(PROFILE_COLUMNS)
    .eq(column, value)
    .maybeSingle();
  if (error) throw roomError("INTERNAL_ERROR");
  if (!data) return null;
  const row = data;
  const alias = (await getCustomAlias(db, row.owner_subject_hash)) ?? row.room_name;
  return mapProfile(row, alias);
}

export async function getOwnProfile(db: Db, subjectHash: string): Promise<ProfileRow> {
  await ensurePersonalRoom(db, subjectHash);
  const profile = await loadByColumn(db, "owner_subject_hash", subjectHash);
  if (!profile) throw roomError("ROOM_UNAVAILABLE");
  return profile;
}

/** Resolves a handle, following an old handle to its new profile. */
export async function findProfileByHandle(db: Db, rawHandle: string) {
  const handle = rawHandle.trim().replace(/^@+/, "").toLowerCase();
  const direct = await loadByColumn(db, "handle", handle);
  if (direct) return { profile: direct, redirected_from: null as string | null };

  const { data } = await db
    .from("handle_redirects")
    .select("owner_subject_hash")
    .eq("old_handle", handle)
    .maybeSingle();
  if (!data) return null;

  const moved = await loadByColumn(db, "owner_subject_hash", data.owner_subject_hash);
  return moved ? { profile: moved, redirected_from: handle } : null;
}

function normalizeUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw roomError("INVALID_INPUT", "Der Link ist keine gültige Web-Adresse.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw roomError("INVALID_INPUT", "Erlaubt sind nur http- und https-Links.");
  }
  return parsed.toString();
}

export interface ProfilePatch {
  display_name?: string | undefined;
  bio?: string | undefined;
  location?: string | undefined;
  external_url?: string | undefined;
  profile_visibility?: "public" | "private" | undefined;
  show_online_status?: boolean | undefined;
  show_follower_count?: boolean | undefined;
  show_likes?: boolean | undefined;
}

export async function updateProfile(db: Db, subjectHash: string, patch: ProfilePatch) {
  await ensurePersonalRoom(db, subjectHash);
  const update: Record<string, unknown> = {};

  // The chosen public user name is globally unique and is claimed atomically.
  // Changing it never changes the handle.
  if (typeof patch.display_name === "string") {
    const clean = sanitizeAlias(patch.display_name);
    if (!clean) throw roomError("INVALID_INPUT");
    await setSubjectAlias(db, subjectHash, clean);
  }
  if (typeof patch.bio === "string") {
    update["description"] = patch.bio.trim().slice(0, BIO_MAX) || null;
  }
  if (typeof patch.location === "string") {
    update["location"] = patch.location.trim().slice(0, LOCATION_MAX) || null;
  }
  if (typeof patch.external_url === "string") {
    const url = normalizeUrl(patch.external_url);
    update["external_url"] = url || null;
  }
  if (patch.profile_visibility === "public" || patch.profile_visibility === "private") {
    update["profile_visibility"] = patch.profile_visibility;
  }
  if (typeof patch.show_online_status === "boolean")
    update["show_online_status"] = patch.show_online_status;
  if (typeof patch.show_follower_count === "boolean")
    update["show_follower_count"] = patch.show_follower_count;
  if (typeof patch.show_likes === "boolean") update["show_likes"] = patch.show_likes;

  if (!Object.keys(update).length && typeof patch.display_name !== "string") {
    throw roomError("INVALID_INPUT");
  }

  if (Object.keys(update).length) {
    const { error } = await db
      .from("user_rooms")
      .update(update)
      .eq("owner_subject_hash", subjectHash);
    if (error) throw roomError("INTERNAL_ERROR");
  }
  return getOwnProfile(db, subjectHash);
}

/* ---------------------------- avatar and banner ---------------------------- */

export type ProfileImageKind = "avatar" | "banner";

/**
 * Downloads, validates and stores a profile image.
 * Only JPG/PNG/WebP within the configured size limit pass; metadata (EXIF/GPS)
 * is stripped before the bytes are written.
 */
export async function setProfileImageFromUrl(
  db: Db,
  subjectHash: string,
  kind: ProfileImageKind,
  sourceUrl: string,
) {
  const limits = imageConfig();

  let bytes: Uint8Array;
  try {
    const fetched = await fetchImageSafely(String(sourceUrl ?? ""), limits.maxImageBytes);
    bytes = fetched.bytes;
  } catch (error) {
    // Never surface the target URL, host, IP or transport error.
    if (error instanceof SafeFetchError && error.reason === "too_large") {
      throw roomError("IMAGE_TOO_LARGE");
    }
    throw roomError(
      "INVALID_INPUT",
      "Das Bild konnte von dieser Adresse nicht geladen werden. Erlaubt sind nur oeffentlich erreichbare https-Adressen mit JPG, PNG oder WebP.",
    );
  }

  return storeProfileImage(db, await getOwnProfile(db, subjectHash), kind, bytes);
}

/**
 * Stores raw image bytes (e.g. a file the person uploaded in the chat client)
 * as avatar or banner. Same validation and metadata stripping as the URL path.
 */
export async function setProfileImageFromBytes(
  db: Db,
  subjectHash: string,
  kind: ProfileImageKind,
  bytes: Uint8Array,
) {
  return storeProfileImage(db, await getOwnProfile(db, subjectHash), kind, bytes);
}

/** Same as above, addressed by personal room id (used by the upload endpoint). */
export async function setProfileImageForRoom(
  db: Db,
  roomId: string,
  kind: ProfileImageKind,
  bytes: Uint8Array,
) {
  const profile = await loadByColumn(db, "room_id", roomId);
  if (!profile) throw roomError("ROOM_UNAVAILABLE");
  return storeProfileImage(db, profile, kind, bytes);
}

async function storeProfileImage(
  db: Db,
  profile: ProfileRow,
  kind: ProfileImageKind,
  bytes: Uint8Array,
) {
  const limits = imageConfig();
  const sanitized = sanitizeImage(bytes);
  if (!sanitized) throw roomError("IMAGE_TYPE_UNSUPPORTED");
  if (sanitized.bytes.byteLength > limits.maxImageBytes) throw roomError("IMAGE_TOO_LARGE");

  const extension =
    sanitized.mime === "image/png" ? "png" : sanitized.mime === "image/webp" ? "webp" : "jpg";
  const path = `profiles/${profile.roomId}/${kind}-${Date.now()}.${extension}`;
  await uploadObject(db, path, sanitized.bytes, sanitized.mime);

  const previous = kind === "avatar" ? profile.avatarPath : profile.bannerPath;
  const column = kind === "avatar" ? "avatar_path" : "banner_path";
  const { error } = await db
    .from("user_rooms")
    .update({ [column]: path })
    .eq("room_id", profile.roomId);
  if (error) throw roomError("INTERNAL_ERROR");
  if (previous) await removeStorageObjects(db, [previous]);

  return { kind, url: await publicProfileImageUrl(profile.roomId, kind) };
}


export async function removeProfileImage(db: Db, subjectHash: string, kind: ProfileImageKind) {
  const profile = await getOwnProfile(db, subjectHash);
  const previous = kind === "avatar" ? profile.avatarPath : profile.bannerPath;
  const column = kind === "avatar" ? "avatar_path" : "banner_path";
  await db
    .from("user_rooms")
    .update({ [column]: null })
    .eq("owner_subject_hash", subjectHash);
  if (previous) await removeStorageObjects(db, [previous]);
  return { kind, removed: Boolean(previous) };
}

export async function profileImageUrls(db: Db, profile: ProfileRow) {
  // Stable app-hosted URLs: the assistant renders these directly as images.
  // Missing images are omitted entirely so no empty "Banner: —" line appears.
  return {
    ...(profile.avatarPath
      ? { profile_image_url: await publicProfileImageUrl(profile.roomId, "avatar") }
      : {}),
    ...(profile.bannerPath
      ? { banner_image_url: await publicProfileImageUrl(profile.roomId, "banner") }
      : {}),
  };
}


/* ---------------------------------- likes --------------------------------- */

export type LikeTarget = "profile" | "message" | "image";

export async function likeCount(db: Db, targetType: LikeTarget, targetId: string): Promise<number> {
  const { count } = await db
    .from("content_likes")
    .select("id", { count: "exact", head: true })
    .eq("target_type", targetType)
    .eq("target_id", targetId);
  return count ?? 0;
}

export async function hasLiked(
  db: Db,
  subjectHash: string,
  targetType: LikeTarget,
  targetId: string,
): Promise<boolean> {
  const { data } = await db
    .from("content_likes")
    .select("id")
    .eq("subject_hash", subjectHash)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .maybeSingle();
  return Boolean(data);
}

export async function likeCountsFor(
  db: Db,
  targetType: LikeTarget,
  targetIds: string[],
  viewerHash: string,
): Promise<Record<string, { likes: number; liked_by_me: boolean }>> {
  const out: Record<string, { likes: number; liked_by_me: boolean }> = {};
  if (!targetIds.length) return out;
  const { data } = await db
    .from("content_likes")
    .select("target_id, subject_hash")
    .eq("target_type", targetType)
    .in("target_id", targetIds);
  for (const id of targetIds) out[id] = { likes: 0, liked_by_me: false };
  for (const row of data ?? []) {
    const entry = out[row.target_id];
    if (!entry) continue;
    entry.likes += 1;
    if (row.subject_hash === viewerHash) entry.liked_by_me = true;
  }
  return out;
}

/** Total likes a person has received across profile, messages and images. */
export async function receivedLikes(db: Db, ownerSubjectHash: string): Promise<number> {
  const { count } = await db
    .from("content_likes")
    .select("id", { count: "exact", head: true })
    .eq("owner_subject_hash", ownerSubjectHash);
  return count ?? 0;
}

export async function addLike(
  db: Db,
  subjectHash: string,
  targetType: LikeTarget,
  targetId: string,
  ownerSubjectHash: string,
  roomId: string | null,
) {
  if (ownerSubjectHash === subjectHash) {
    throw roomError("FORBIDDEN", "Eigene Inhalte kannst du nicht liken.");
  }
  const { error } = await db.from("content_likes").insert({
    subject_hash: subjectHash,
    target_type: targetType,
    target_id: targetId,
    owner_subject_hash: ownerSubjectHash,
    room_id: roomId,
  });
  // Unique violation => already liked; a like never counts twice.
  if (error && !String(error.code).startsWith("23")) throw roomError("INTERNAL_ERROR");

  await recordEvent(db, {
    roomId,
    ownerSubjectHash,
    type: "like",
    actorHash: subjectHash,
    metadata: { target_type: targetType },
  });
  return { likes: await likeCount(db, targetType, targetId), already: Boolean(error) };
}

export async function removeLike(
  db: Db,
  subjectHash: string,
  targetType: LikeTarget,
  targetId: string,
) {
  const { error } = await db
    .from("content_likes")
    .delete()
    .eq("subject_hash", subjectHash)
    .eq("target_type", targetType)
    .eq("target_id", targetId);
  if (error) throw roomError("INTERNAL_ERROR");
  return { likes: await likeCount(db, targetType, targetId) };
}

/* -------------------------------- analytics -------------------------------- */

export type AnalyticsEventType =
  | "profile_view"
  | "room_visit"
  | "link_click"
  | "message_view"
  | "image_view"
  | "follow"
  | "unfollow"
  | "like";

export async function recordEvent(
  db: Db,
  event: {
    roomId: string | null;
    ownerSubjectHash: string;
    type: AnalyticsEventType;
    actorHash?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  if (!event.roomId) return;
  await db.from("analytics_events").insert({
    room_id: event.roomId,
    owner_subject_hash: event.ownerSubjectHash,
    event_type: event.type,
    // Actor stays pseudonymous and is never exposed in analytics output.
    actor_hash: event.actorHash ?? null,
    metadata: event.metadata ?? {},
  });
}

function bucketOf(iso: string) {
  return iso.slice(0, 10);
}

export async function profileAnalytics(db: Db, profile: ProfileRow, days: 7 | 30 | 90) {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const { data, error } = await db
    .from("analytics_events")
    .select("event_type, actor_hash, created_at, metadata")
    .eq("owner_subject_hash", profile.ownerSubjectHash)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(20000);
  if (error) throw roomError("INTERNAL_ERROR");

  const rows = data ?? [];
  const totals: Record<string, number> = {};
  const uniqueVisitors = new Set<string>();
  const roomVisitors = new Set<string>();
  const series: Record<string, Record<string, number>> = {};
  const durations: number[] = [];

  for (const row of rows) {
    totals[row.event_type] = (totals[row.event_type] ?? 0) + 1;
    if (row.event_type === "profile_view" && row.actor_hash) uniqueVisitors.add(row.actor_hash);
    if (row.event_type === "room_visit" && row.actor_hash) roomVisitors.add(row.actor_hash);
    const seconds = Number(row.metadata?.duration_seconds);
    if (Number.isFinite(seconds) && seconds > 0) durations.push(seconds);
    const day = bucketOf(row.created_at);
    series[day] ??= {};
    series[day][row.event_type] = (series[day][row.event_type] ?? 0) + 1;
  }

  const followers = await followerCount(db, profile.roomId);
  const likes = await receivedLikes(db, profile.ownerSubjectHash);
  const engagementBase = (totals["profile_view"] ?? 0) + (totals["room_visit"] ?? 0);
  const engagement = engagementBase
    ? Math.round(((likes + (totals["follow"] ?? 0)) / engagementBase) * 1000) / 10
    : 0;

  return {
    range_days: days,
    profile_views: totals["profile_view"] ?? 0,
    unique_visitors: uniqueVisitors.size,
    new_followers: totals["follow"] ?? 0,
    unfollows: totals["unfollow"] ?? 0,
    likes: totals["like"] ?? 0,
    message_views: totals["message_view"] ?? 0,
    image_views: totals["image_view"] ?? 0,
    link_clicks: totals["link_click"] ?? 0,
    room_visits: totals["room_visit"] ?? 0,
    unique_room_visitors: roomVisitors.size,
    average_visit_seconds: durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : 0,
    online_now: await countOnline(db, profile.roomId),
    followers_total: followers,
    likes_total: likes,
    engagement_rate_percent: engagement,
    daily: Object.entries(series)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, counts]) => ({ day, ...counts })),
  };
}

/** Top messages / images of the profile owner, ranked by likes. */
export async function topContent(db: Db, profile: ProfileRow) {
  const { data } = await db
    .from("content_likes")
    .select("target_type, target_id")
    .eq("owner_subject_hash", profile.ownerSubjectHash)
    .limit(5000);

  const tally: Record<string, Record<string, number>> = { message: {}, image: {} };
  for (const row of data ?? []) {
    const bucket = tally[row.target_type];
    if (!bucket) continue;
    bucket[row.target_id] = (bucket[row.target_id] ?? 0) + 1;
  }
  const rank = (kind: "message" | "image") =>
    Object.entries(tally[kind] ?? {})
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([id, likes]) => ({ id, likes }));

  return { top_messages: rank("message"), top_images: rank("image") };
}

/* ------------------------------ public metrics ----------------------------- */

export async function publicMetrics(db: Db, profile: ProfileRow, viewerHash: string) {
  const followers = await followerCount(db, profile.roomId);

  const { count: following } = await db
    .from("room_followers")
    .select("id", { count: "exact", head: true })
    .eq("follower_subject_hash", profile.ownerSubjectHash);

  const { count: messages } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("room_id", profile.roomId)
    .gte("created_at", retentionCutoffIso());

  const { count: images } = await db
    .from("image_messages")
    .select("id", { count: "exact", head: true })
    .eq("room_id", profile.roomId)
    .eq("moderation_status", "approved")
    .gte("created_at", retentionCutoffIso());

  const here = await liveCount(db, profile.roomId);
  const online = profile.showOnlineStatus ? await ownerOnline(db, profile) : null;
  const likes = await receivedLikes(db, profile.ownerSubjectHash);

  return {
    followers: profile.showFollowerCount ? followers : null,
    following: following ?? 0,
    likes_received: profile.showLikes ? likes : null,
    messages: messages ?? 0,
    images: images ?? 0,
    people_here_now: here,
    online: online,
    presence_window_seconds: PRESENCE_WINDOW_SECONDS,
    presence_checked_at: new Date().toISOString(),
    liked_profile_by_me: await hasLiked(db, viewerHash, "profile", profile.roomId),
    is_following: await isFollowing(db, profile.roomId, viewerHash),
    headline: `${profile.showFollowerCount ? followers : "—"} followers · ${here} people here now${
      profile.showLikes ? ` · ${likes} likes` : ""
    }`,
  };
}

async function ownerOnline(db: Db, profile: ProfileRow): Promise<boolean> {
  const since = new Date(Date.now() - PRESENCE_WINDOW_SECONDS * 1000).toISOString();
  const { count } = await db
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("room_id", profile.roomId)
    .eq("subject_hash", profile.ownerSubjectHash)
    .is("left_at", null)
    .gte("last_seen_at", since);
  return (count ?? 0) > 0;
}

/* --------------------------------- blocking -------------------------------- */

export async function blockPerson(db: Db, subjectHash: string, blocked: string, reason?: string) {
  if (subjectHash === blocked)
    throw roomError("FORBIDDEN", "Du kannst dich nicht selbst blockieren.");
  const { error } = await db
    .from("profile_blocks")
    .insert({ subject_hash: subjectHash, blocked_subject_hash: blocked, reason: reason ?? null });
  if (error && !String(error.code).startsWith("23")) throw roomError("INTERNAL_ERROR");
  return true;
}

export async function isBlocked(db: Db, subjectHash: string, other: string): Promise<boolean> {
  const { data } = await db
    .from("profile_blocks")
    .select("id")
    .or(
      `and(subject_hash.eq.${subjectHash},blocked_subject_hash.eq.${other}),and(subject_hash.eq.${other},blocked_subject_hash.eq.${subjectHash})`,
    )
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * Removes a block. Idempotent: unblocking someone who is not blocked simply
 * reports `blocked: false` instead of failing.
 */
export async function unblockPerson(
  db: Db,
  subjectHash: string,
  blocked: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("profile_blocks")
    .delete()
    .eq("subject_hash", subjectHash)
    .eq("blocked_subject_hash", blocked)
    .select("id");
  if (error) throw roomError("INTERNAL_ERROR");
  return (data ?? []).length > 0;
}

/**
 * The people the caller blocked, as @handle and display name only.
 * Subject hashes, account ids and reasons never leave the server.
 */
export async function listBlocks(
  db: Db,
  subjectHash: string,
): Promise<Array<{ handle: string; display_name: string }>> {
  const { data, error } = await db
    .from("profile_blocks")
    .select("blocked_subject_hash, created_at")
    .eq("subject_hash", subjectHash)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw roomError("INTERNAL_ERROR");

  const rows = (data ?? []) as Array<{ blocked_subject_hash: string }>;
  if (!rows.length) return [];

  const { data: roomRows } = await db
    .from("user_rooms")
    .select("owner_subject_hash, handle, room_name")
    .in(
      "owner_subject_hash",
      rows.map((row) => row.blocked_subject_hash),
    );

  const byHash = new Map<string, { handle: string; room_name: string }>();
  for (const row of roomRows ?? []) {
    byHash.set(row.owner_subject_hash, { handle: row.handle, room_name: row.room_name });
  }

  const out: Array<{ handle: string; display_name: string }> = [];
  for (const row of rows) {
    const room = byHash.get(row.blocked_subject_hash);
    if (!room) continue;
    out.push({ handle: room.handle, display_name: room.room_name });
  }
  return out;
}

/* --------------------------------- helpers -------------------------------- */

export async function aliasOf(db: Db, subjectHash: string): Promise<string> {
  return (await getCustomAlias(db, subjectHash)) ?? generateAlias(`${subjectHash}:personal`);
}

export function profileUrl(handle: string, base: string): string {
  const root = base.replace(/\/+$/, "");
  return `${root}/@${handle}`;
}
