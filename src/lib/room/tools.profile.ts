/**
 * MCP handlers for the social profile: view, edit, images, likes, analytics.
 * Ownership is always the pseudonymous subject from `_meta` — never an input.
 */
import { imageConfig, IMAGE_RETENTION } from "./config";
import { roomError } from "./errors";
import { resolveIdentity, type McpMeta } from "./identity";
import { decodeImageId, decodeMessageId, encodeImageId, encodeMessageId } from "./ids";
import { aliasesFor, listApprovedImages, signedUrl } from "./imagestore";
import { listFollowedRooms, listFollowers } from "./personal";
import {
  addLike,
  blockPerson,
  changeHandle,
  findProfileByHandle,
  getOwnProfile,
  isBlocked,
  likeCountsFor,
  profileAnalytics,
  profileImageUrls,
  publicMetrics,
  recordEvent,
  removeLike,
  removeProfileImage,
  setProfileImageFromUrl,
  suggestHandles,
  topContent,
  updateProfile,
  type LikeTarget,
  type ProfileRow,
} from "./profile";
import { enforceRateLimit, WINDOWS } from "./ratelimit";
import { getDb, touchPresence, type Db } from "./store";

export const PROFILE_DISPLAY_INSTRUCTION =
  "Zeige das Profil wie ein Social-Media-Profil: Banner (Markdown-Bild), Avatar, Anzeigename, @handle, Bio, Ort, Link, dann die Zeile «X followers · Y following · Z likes · N people here now» und danach die Tabs Nachrichten, Bilder und Likes. Übersetze Bio und Nachrichten in die Sprache der Person. Beim eigenen Profil biete Bearbeiten an (Name, Bio, Ort, Link, Bilder, Handle, Sichtbarkeit).";

/* -------------------------------- helpers -------------------------------- */

async function profileMessages(db: Db, profile: ProfileRow, viewerHash: string) {
  const { data, error } = await db
    .from("messages")
    .select("id, body, created_at, memberships(alias, subject_hash)")
    .eq("room_id", profile.roomId)
    .gt("expires_at", new Date().toISOString())
    .order("id", { ascending: false })
    .limit(20);
  if (error) throw roomError("INTERNAL_ERROR");

  const rows = ((data ?? []) as any[]).reverse();
  const likes = await likeCountsFor(db, "message", rows.map((row) => String(row.id)), viewerHash);
  return Promise.all(
    rows.map(async (row) => ({
      id: await encodeMessageId(row.id),
      alias: row.memberships?.alias ?? "Unbekannt",
      text: row.body as string,
      created_at: new Date(row.created_at).toISOString(),
      is_owner: row.memberships?.subject_hash === profile.ownerSubjectHash,
      likes: likes[String(row.id)]?.likes ?? 0,
      liked_by_me: likes[String(row.id)]?.liked_by_me ?? false,
    })),
  );
}

async function profileImages(db: Db, profile: ProfileRow, viewerHash: string) {
  const rows = await listApprovedImages(db, profile.roomId, IMAGE_RETENTION);
  const aliases = await aliasesFor(db, rows.map((row) => row.sender_membership_id));
  const ttl = imageConfig().signedUrlTtlSeconds;
  const likes = await likeCountsFor(db, "image", rows.map((row) => String(row.id)), viewerHash);
  return Promise.all(
    rows.map(async (row) => ({
      id: await encodeImageId(row.id),
      alias: aliases[row.sender_membership_id] ?? "Unbekannt",
      alt_text: row.alt_text ?? "",
      created_at: new Date(row.created_at).toISOString(),
      url: (await signedUrl(db, row.storage_path, ttl)) ?? "",
      likes: likes[String(row.id)]?.likes ?? 0,
      liked_by_me: likes[String(row.id)]?.liked_by_me ?? false,
    })),
  );
}

async function serializeProfile(db: Db, profile: ProfileRow, viewerHash: string) {
  const media = await profileImageUrls(db, profile);
  const metrics = await publicMetrics(db, profile, viewerHash);
  return {
    handle: profile.handle,
    display_name: profile.roomName,
    bio: profile.bio ?? "",
    location: profile.location ?? "",
    external_url: profile.externalUrl ?? "",
    joined_at: profile.createdAt,
    visibility: profile.visibility,
    is_owner: profile.ownerSubjectHash === viewerHash,
    ...media,
    ...metrics,
  };
}

/* ------------------------------- view profile ------------------------------ */

export async function handleGetProfile(input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);

  const requested = (input as any)?.username;
  let profile: ProfileRow;
  let redirectedFrom: string | null = null;

  if (typeof requested === "string" && requested.trim()) {
    const found = await findProfileByHandle(db, requested);
    if (!found) throw roomError("NOT_FOUND", "Dieses Profil gibt es nicht.");
    profile = found.profile;
    redirectedFrom = found.redirected_from;
  } else {
    profile = await getOwnProfile(db, identity.subjectHash);
  }

  const isOwner = profile.ownerSubjectHash === identity.subjectHash;
  if (!isOwner && (await isBlocked(db, identity.subjectHash, profile.ownerSubjectHash))) {
    throw roomError("FORBIDDEN", "Dieses Profil ist für dich nicht sichtbar.");
  }
  if (!isOwner && profile.visibility === "private") {
    return {
      profile: {
        handle: profile.handle,
        display_name: profile.roomName,
        visibility: "private",
        is_owner: false,
      },
      message: `@${profile.handle} hat das Profil auf privat gestellt.`,
      display_instruction: "Sag freundlich, dass dieses Profil privat ist. Zeige keine Inhalte.",
    };
  }

  if (!isOwner) {
    await recordEvent(db, {
      roomId: profile.roomId,
      ownerSubjectHash: profile.ownerSubjectHash,
      type: "profile_view",
      actorHash: identity.subjectHash,
    });
  }

  return {
    profile: await serializeProfile(db, profile, identity.subjectHash),
    redirected_from: redirectedFrom,
    tabs: {
      messages: await profileMessages(db, profile, identity.subjectHash),
      images: await profileImages(db, profile, identity.subjectHash),
      followers: profile.showFollowerCount ? await listFollowers(db, profile.roomId, 50) : [],
      following: isOwner ? await listFollowedRooms(db, profile.ownerSubjectHash) : [],
    },
    edit_hint: isOwner
      ? "Du kannst Anzeigename, Bio, Ort, Link, Profilbild, Banner, Handle und Sichtbarkeit ändern."
      : null,
    display_instruction: PROFILE_DISPLAY_INSTRUCTION,
  };
}

/* -------------------------------- edit profile ----------------------------- */

export async function handleUpdateProfile(input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);

  const patch = (input ?? {}) as any;
  const profile = await updateProfile(db, identity.subjectHash, {
    display_name: patch.display_name,
    bio: patch.bio,
    location: patch.location,
    external_url: patch.external_url,
    profile_visibility: patch.profile_visibility,
    show_online_status: patch.show_online_status,
    show_follower_count: patch.show_follower_count,
    show_likes: patch.show_likes,
  });

  return {
    profile: await serializeProfile(db, profile, identity.subjectHash),
    message: "Profil aktualisiert.",
  };
}

export async function handleChangeHandle(input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const desired = (input as any)?.handle;

  try {
    const result = await changeHandle(db, identity.subjectHash, desired);
    return {
      ...result,
      message: result.changed
        ? `Dein Handle ist jetzt @${result.handle}. Links auf @${result.old_handle} leiten weiter.`
        : `Du nutzt bereits @${result.handle}.`,
    };
  } catch (error) {
    if ((error as any)?.code === "ALIAS_TAKEN") {
      const suggestions = await suggestHandles(db, String(desired ?? ""), identity.subjectHash);
      throw roomError(
        "ALIAS_TAKEN",
        `@${String(desired).replace(/^@+/, "")} ist vergeben. Frei wären: ${suggestions
          .map((s) => `@${s}`)
          .join(", ")}`,
        { suggestions },
      );
    }
    throw error;
  }
}

export async function handleSetProfileImage(input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const payload = (input ?? {}) as any;
  const kind = payload.kind === "banner" ? "banner" : "avatar";

  await enforceRateLimit(db, identity.subjectHash, "profile_image", WINDOWS.join(10));

  if (payload.remove === true || payload.image_url === null) {
    const result = await removeProfileImage(db, identity.subjectHash, kind);
    return { ...result, message: kind === "banner" ? "Banner entfernt." : "Profilbild entfernt." };
  }
  if (typeof payload.image_url !== "string" || !payload.image_url.trim()) {
    throw roomError("INVALID_INPUT", "Bitte gib eine Bild-Adresse (https) an oder setze remove: true.");
  }

  const result = await setProfileImageFromUrl(db, identity.subjectHash, kind, payload.image_url);
  return {
    ...result,
    message: kind === "banner" ? "Banner aktualisiert." : "Profilbild aktualisiert.",
    display_instruction: "Zeige das neue Bild als Markdown ![](url) in der Antwort.",
  };
}

/* ----------------------------------- likes --------------------------------- */

async function resolveLikeTarget(
  db: Db,
  targetType: LikeTarget,
  rawId: unknown,
): Promise<{ targetId: string; ownerSubjectHash: string; roomId: string | null }> {
  if (targetType === "profile") {
    const found = await findProfileByHandle(db, String(rawId ?? ""));
    if (!found) throw roomError("NOT_FOUND", "Dieses Profil gibt es nicht.");
    return {
      targetId: found.profile.roomId,
      ownerSubjectHash: found.profile.ownerSubjectHash,
      roomId: found.profile.roomId,
    };
  }

  if (targetType === "message") {
    const id = await decodeMessageId(rawId);
    if (!id) throw roomError("MESSAGE_NOT_FOUND");
    const { data } = await db
      .from("messages")
      .select("id, room_id, memberships(subject_hash)")
      .eq("id", id)
      .maybeSingle();
    if (!data) throw roomError("MESSAGE_NOT_FOUND");
    return {
      targetId: String(id),
      ownerSubjectHash: (data as any).memberships?.subject_hash ?? "",
      roomId: (data as any).room_id,
    };
  }

  const id = await decodeImageId(rawId);
  if (!id) throw roomError("IMAGE_NOT_FOUND");
  const { data } = await db
    .from("image_messages")
    .select("id, room_id, memberships:sender_membership_id(subject_hash)")
    .eq("id", id)
    .maybeSingle();
  if (!data) throw roomError("IMAGE_NOT_FOUND");
  return {
    targetId: String(id),
    ownerSubjectHash: (data as any).memberships?.subject_hash ?? "",
    roomId: (data as any).room_id,
  };
}

function likeType(raw: unknown): LikeTarget {
  if (raw === "profile" || raw === "message" || raw === "image") return raw;
  throw roomError("INVALID_INPUT", "target_type muss profile, message oder image sein.");
}

export async function handleLikeContent(input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);

  const payload = (input ?? {}) as any;
  const targetType = likeType(payload.target_type);
  await enforceRateLimit(db, identity.subjectHash, "like", WINDOWS.message(20, 200));

  const target = await resolveLikeTarget(db, targetType, payload.target_id ?? payload.username);
  const result = await addLike(
    db,
    identity.subjectHash,
    targetType,
    target.targetId,
    target.ownerSubjectHash,
    target.roomId,
  );
  return {
    target_type: targetType,
    likes: result.likes,
    liked_by_me: true,
    message: result.already ? "Du hast das bereits geliked." : "Like gespeichert.",
  };
}

export async function handleUnlikeContent(input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const payload = (input ?? {}) as any;
  const targetType = likeType(payload.target_type);
  const target = await resolveLikeTarget(db, targetType, payload.target_id ?? payload.username);
  const result = await removeLike(db, identity.subjectHash, targetType, target.targetId);
  return { target_type: targetType, likes: result.likes, liked_by_me: false, message: "Like entfernt." };
}

/* --------------------------------- analytics ------------------------------- */

export async function handleProfileAnalytics(input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const profile = await getOwnProfile(db, identity.subjectHash);

  const requested = Number((input as any)?.range_days ?? 30);
  const days: 7 | 30 | 90 = requested === 7 ? 7 : requested === 90 ? 90 : 30;

  const stats = await profileAnalytics(db, profile, days);
  const top = await topContent(db, profile);

  return {
    handle: profile.handle,
    ...stats,
    ...top,
    privacy_note:
      "Analytics sind nur für dich sichtbar und enthalten keine Identitäten anderer Personen.",
    display_instruction:
      "Zeige die Kennzahlen als kompakte Liste und danach den Verlauf pro Tag als kleine Textgrafik. Keine Namen von Besucherinnen und Besuchern nennen — es gibt keine.",
  };
}

/** Records a click on the profile's external link (owner-only analytics). */
export async function handleTrackProfileLink(input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const found = await findProfileByHandle(db, String((input as any)?.username ?? ""));
  if (!found) throw roomError("NOT_FOUND", "Dieses Profil gibt es nicht.");

  await recordEvent(db, {
    roomId: found.profile.roomId,
    ownerSubjectHash: found.profile.ownerSubjectHash,
    type: "link_click",
    actorHash: identity.subjectHash,
  });
  return { url: found.profile.externalUrl ?? "", message: "Link geöffnet." };
}

export async function handleBlockProfile(input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const found = await findProfileByHandle(db, String((input as any)?.username ?? ""));
  if (!found) throw roomError("NOT_FOUND", "Dieses Profil gibt es nicht.");

  await blockPerson(db, identity.subjectHash, found.profile.ownerSubjectHash, (input as any)?.reason);
  return { handle: found.profile.handle, message: `@${found.profile.handle} ist blockiert.` };
}
