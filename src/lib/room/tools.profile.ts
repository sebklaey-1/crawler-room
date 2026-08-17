/**
 * MCP handlers for the social profile: view, edit, images, likes, analytics.
 * Ownership is always the pseudonymous subject from `_meta` — never an input.
 */
import { embedded, payloadOf, type EmbeddedShapes } from "./dbtypes";
import { IMAGE_RETENTION, retentionCutoffIso } from "./config";
import { roomError } from "./errors";
import { resolveIdentity, type McpMeta } from "./identity";
import { decodeImageId, decodeMessageId, encodeImageId, encodeMessageId } from "./ids";
import { aliasesFor, listApprovedImages } from "./imagestore";
import { publicImageUrl } from "./imageurl";
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
  "PFLICHT: Gib den mitgelieferten Markdown-Text der Antwort unverändert und vollständig aus. Vorhandene Bilder immer als ![alt](url) rendern — niemals als Link, Codeblock oder Beschreibung, URLs nie kürzen oder verändern. Fehlt ein Banner oder Profilbild, lasse die Zeile komplett weg: niemals «Banner: —» oder «Profilbild: —» oder ähnliche Platzhalter ausgeben und nicht erwähnen, dass ein Bild fehlt. Reihenfolge: Banner, Profilbild, Anzeigename, @handle, Bio, Link/Beitritt, Kennzahlen-Tabelle (followers · following · likes · people here now), dann Nachrichten und Bilder. Übersetze nur Bio, Nachrichten und Alt-Texte in die Sprache der Person; Zahlen, Handles und Bild-URLs bleiben unverändert. Beim eigenen Profil biete Bearbeiten an (Name, Bio, Link, Bilder, Handle, Sichtbarkeit).";


/* -------------------------------- helpers -------------------------------- */

async function profileMessages(db: Db, profile: ProfileRow, viewerHash: string) {
  const { data, error } = await db
    .from("messages")
    .select("id, body, created_at, memberships(alias, subject_hash)")
    .eq("room_id", profile.roomId)
    .gte("created_at", retentionCutoffIso())
    .gt("expires_at", new Date().toISOString())
    .order("id", { ascending: false })
    .limit(20);
  if (error) throw roomError("INTERNAL_ERROR");

  const rows = (data ?? []).reverse();
  const likes = await likeCountsFor(
    db,
    "message",
    rows.map((row) => String(row.id)),
    viewerHash,
  );
  return Promise.all(
    rows.map(async (row) => ({
      id: await encodeMessageId(row.id),
      alias: embedded<EmbeddedShapes["memberships"]>(row.memberships)?.alias ?? "Unbekannt",
      text: row.body as string,
      created_at: new Date(row.created_at).toISOString(),
      is_owner:
        embedded<EmbeddedShapes["memberships"]>(row.memberships)?.subject_hash ===
        profile.ownerSubjectHash,
      likes: likes[String(row.id)]?.likes ?? 0,
      liked_by_me: likes[String(row.id)]?.liked_by_me ?? false,
    })),
  );
}

async function profileImages(db: Db, profile: ProfileRow, viewerHash: string) {
  const rows = await listApprovedImages(db, profile.roomId, IMAGE_RETENTION);
  const aliases = await aliasesFor(
    db,
    rows.map((row) => row.sender_membership_id),
  );
  const likes = await likeCountsFor(
    db,
    "image",
    rows.map((row) => String(row.id)),
    viewerHash,
  );
  return Promise.all(
    rows.map(async (row) => ({
      id: await encodeImageId(row.id),
      alias: aliases[row.sender_membership_id] ?? "Unbekannt",
      alt_text: row.alt_text ?? "",
      created_at: new Date(row.created_at).toISOString(),
      url: await publicImageUrl(row.id),
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

  const requested = payloadOf<{ username?: unknown }>(input).username;
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
      ? "Du kannst Anzeigename, Bio, Link, Profilbild, Banner, Handle und Sichtbarkeit ändern."
      : null,
    display_instruction: PROFILE_DISPLAY_INSTRUCTION,
  };
}

/* -------------------------------- edit profile ----------------------------- */

export async function handleUpdateProfile(input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  await touchPresence(db, identity.subjectHash);

  const patch = payloadOf<{
    display_name?: string;
    bio?: string | null;
    external_url?: string | null;
    profile_visibility?: string;
    show_online_status?: boolean;
    show_follower_count?: boolean;
    show_likes?: boolean;
  }>(input);
  const profile = await updateProfile(db, identity.subjectHash, {
    display_name: patch.display_name,
    bio: patch.bio ?? undefined,
    external_url: patch.external_url ?? undefined,
    profile_visibility:
      patch.profile_visibility === "private" || patch.profile_visibility === "public"
        ? patch.profile_visibility
        : undefined,
    show_online_status: patch.show_online_status,
    show_follower_count: patch.show_follower_count,
    show_likes: patch.show_likes,
  });

  return {
    profile: await serializeProfile(db, profile, identity.subjectHash),
    message: "Profil aktualisiert.",
    display_instruction: PROFILE_DISPLAY_INSTRUCTION,
  };
}

export async function handleChangeHandle(input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const desired = payloadOf<{ handle?: string }>(input).handle;

  try {
    const result = await changeHandle(db, identity.subjectHash, desired);
    return {
      ...result,
      message: result.changed
        ? `Dein Handle ist jetzt @${result.handle}. Links auf @${result.old_handle} leiten weiter.`
        : `Du nutzt bereits @${result.handle}.`,
    };
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "ALIAS_TAKEN") {
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
  const payload = payloadOf<{
    kind?: string;
    remove?: boolean;
    image_url?: string | null;
  }>(input);
  const kind = payload.kind === "banner" ? "banner" : "avatar";

  await enforceRateLimit(db, identity.subjectHash, "profile_image", WINDOWS.join(10));

  if (payload.remove === true || payload.image_url === null) {
    const result = await removeProfileImage(db, identity.subjectHash, kind);
    return { ...result, message: kind === "banner" ? "Banner entfernt." : "Profilbild entfernt." };
  }

  if (typeof payload.image_url !== "string" || !payload.image_url.trim()) {
    throw roomError(
      "INVALID_INPUT",
      "Bitte nenne eine öffentlich abrufbare https-Bild-URL oder setze remove: true.",
    );
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
      ownerSubjectHash:
        embedded<EmbeddedShapes["memberships"]>(data.memberships)?.subject_hash ?? "",
      roomId: data.room_id,
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
    ownerSubjectHash: embedded<EmbeddedShapes["memberships"]>(data.memberships)?.subject_hash ?? "",
    roomId: data.room_id,
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

  const payload = payloadOf<{ target_type?: string; target_id?: string; username?: string }>(input);
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
  const payload = payloadOf<{ target_type?: string; target_id?: string; username?: string }>(input);
  const targetType = likeType(payload.target_type);
  const target = await resolveLikeTarget(db, targetType, payload.target_id ?? payload.username);
  const result = await removeLike(db, identity.subjectHash, targetType, target.targetId);
  return {
    target_type: targetType,
    likes: result.likes,
    liked_by_me: false,
    message: "Like entfernt.",
  };
}

/* --------------------------------- analytics ------------------------------- */

export async function handleProfileAnalytics(input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const profile = await getOwnProfile(db, identity.subjectHash);

  const requested = Number(payloadOf<{ range_days?: number }>(input).range_days ?? 30);
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
      "PFLICHT: Gib den mitgelieferten Markdown-Text unverändert aus — die Balkendiagramme in den ```text-Blöcken müssen genau so erscheinen. Ergänze danach optional eine kurze Einordnung in der Sprache der Person. Keine Namen von Besucherinnen und Besuchern nennen — es gibt keine.",
  };
}

/** Records a click on the profile's external link (owner-only analytics). */
export async function handleTrackProfileLink(input: unknown, meta: McpMeta) {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const found = await findProfileByHandle(
    db,
    String(payloadOf<{ username?: string }>(input).username ?? ""),
  );
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
  const found = await findProfileByHandle(
    db,
    String(payloadOf<{ username?: string }>(input).username ?? ""),
  );
  if (!found) throw roomError("NOT_FOUND", "Dieses Profil gibt es nicht.");

  await blockPerson(
    db,
    identity.subjectHash,
    found.profile.ownerSubjectHash,
    payloadOf<{ reason?: string }>(input).reason,
  );
  return { handle: found.profile.handle, message: `@${found.profile.handle} ist blockiert.` };
}

/* ---------------------------- anonymous read path -------------------------- */

/**
 * Read-only public profile view for signed-out callers.
 * No presence update, no profile-view tracking, no viewer-specific state.
 */
export async function publicProfileView(db: Db, username: unknown) {
  const requested = typeof username === "string" ? username.trim() : "";
  if (!requested) throw roomError("INVALID_INPUT", "Bitte nenne das @handle des Profils.");

  const found = await findProfileByHandle(db, requested);
  if (!found) throw roomError("NOT_FOUND", "Dieses Profil gibt es nicht.");
  const profile = found.profile;

  if (profile.visibility === "private") {
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

  return {
    profile: await serializeProfile(db, profile, ""),
    redirected_from: found.redirected_from,
    authenticated: false,
    tabs: {
      messages: await profileMessages(db, profile, ""),
      images: await profileImages(db, profile, ""),
      followers: profile.showFollowerCount ? await listFollowers(db, profile.roomId, 50) : [],
      following: [],
    },
    edit_hint: null,
    display_instruction: PROFILE_DISPLAY_INSTRUCTION,
    sign_in_hint:
      "Nur Lesen: Folgen, Liken, Blockieren und Bearbeiten sind erst nach Anmeldung bei Crawler Room möglich.",
  };
}
