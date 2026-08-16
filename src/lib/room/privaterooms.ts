/**
 * Owned rooms (Plus/Pro/Business): creation, management, invitations.
 * Every operation re-verifies ownership, plan entitlement and limits
 * server-side; the caller never supplies plan or role information.
 */
import { generateAlias, sanitizeAlias } from "./alias";
import { audit } from "./audit";
import { requireSecret } from "./config";
import { hmacSha256Hex, randomId } from "./crypto";
import { roomError } from "./errors";
import {
  limitOf,
  requireEntitlement,
  requireUnderLimit,
  requireWritablePaidFeatures,
  type AccountContext,
} from "./entitlements";
import { encodeRoomId } from "./ids";
import type { Db } from "./store";

export interface OwnedRoom {
  id: string;
  title: string | null;
  description: string | null;
  visibility: string;
  kind: string;
  capacity: number;
  retention_texts: number | null;
  retention_images: number | null;
  archived_at: string | null;
  owner_account_id: string | null;
  organization_id: string | null;
  topic_id: string | null;
}

const ROOM_COLUMNS =
  "id, title, description, visibility, kind, capacity, retention_texts, retention_images, archived_at, owner_account_id, organization_id, topic_id";

export async function createOwnedRoom(
  db: Db,
  ctx: AccountContext,
  input: {
    title: string;
    description?: string;
    topic?: string;
    visibility: "public" | "private" | "invite" | "paid";
    capacity?: number;
    organizationId?: string;
  },
): Promise<OwnedRoom> {
  requireEntitlement(ctx, "private_rooms");
  requireWritablePaidFeatures(ctx);

  const { count } = await db
    .from("rooms")
    .select("id", { count: "exact", head: true })
    .eq("owner_account_id", ctx.accountId)
    .is("archived_at", null);
  await requireUnderLimit(ctx, "owned_rooms", count ?? 0);

  if (input.visibility === "paid" && !ctx.entitlements["paid_rooms"]) {
    throw roomError("PLAN_REQUIRED", undefined, { required_feature: "paid_rooms" });
  }

  const maxMembers = limitOf(ctx, "room_members", 5);
  const capacity = Math.min(Math.max(input.capacity ?? maxMembers, 2), maxMembers);

  let topicId: string | null = null;
  if (input.topic) {
    const { data: topic } = await db
      .from("topics")
      .select("id")
      .eq("slug", input.topic)
      .maybeSingle();
    topicId = (topic as any)?.id ?? null;
  }

  const { data: maxRow } = await db
    .from("rooms")
    .select("room_number")
    .eq("owner_account_id", ctx.accountId)
    .order("room_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await db
    .from("rooms")
    .insert({
      topic_id: topicId,
      room_number: ((maxRow as any)?.room_number ?? 0) + 1,
      capacity,
      kind: input.organizationId ? "community" : "private",
      owner_account_id: ctx.accountId,
      organization_id: input.organizationId ?? null,
      title: input.title,
      description: input.description ?? null,
      visibility: input.visibility,
      retention_texts: limitOf(ctx, "retention_texts", 7),
      retention_images: limitOf(ctx, "retention_images", 3),
    })
    .select(ROOM_COLUMNS)
    .single();
  if (error || !data) throw roomError("INTERNAL_ERROR");

  const room = data as unknown as OwnedRoom;

  // The owner joins their own room immediately.
  await db.from("memberships").insert({
    topic_id: topicId,
    room_id: room.id,
    subject_hash: ctx.subjectHash,
    account_id: ctx.accountId,
    alias: ctx.customAlias ?? generateAlias(ctx.subjectHash),
    role: "owner",
  });

  await audit(db, {
    actorType: "user",
    actorId: ctx.accountId,
    action: "room.create",
    targetType: "room",
    targetId: room.id,
    metadata: { visibility: room.visibility, capacity },
  });

  return room;
}

export async function loadOwnedRoom(
  db: Db,
  ctx: AccountContext,
  roomId: string,
): Promise<OwnedRoom> {
  const { data } = await db.from("rooms").select(ROOM_COLUMNS).eq("id", roomId).maybeSingle();
  if (!data) throw roomError("NOT_FOUND");
  const room = data as unknown as OwnedRoom;

  if (room.owner_account_id === ctx.accountId) return room;

  if (room.organization_id) {
    const { data: member } = await db
      .from("organization_members")
      .select("role")
      .eq("organization_id", room.organization_id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if ((member as any)?.role === "organization_admin") return room;
  }

  throw roomError("FORBIDDEN");
}

export type ManageAction =
  | "update"
  | "archive"
  | "delete"
  | "change_visibility"
  | "update_retention"
  | "assign_moderator"
  | "remove_moderator";

export async function manageRoom(
  db: Db,
  ctx: AccountContext,
  roomId: string,
  action: ManageAction,
  payload: Record<string, unknown>,
): Promise<{ action: ManageAction; room_id: string; message: string }> {
  requireEntitlement(ctx, "private_rooms");
  requireWritablePaidFeatures(ctx);
  const room = await loadOwnedRoom(db, ctx, roomId);

  const finish = async (message: string) => {
    await audit(db, {
      actorType: "user",
      actorId: ctx.accountId,
      action: `room.${action}`,
      targetType: "room",
      targetId: room.id,
    });
    return { action, room_id: await encodeRoomId(room.id), message };
  };

  switch (action) {
    case "update": {
      const patch: Record<string, unknown> = {};
      if (typeof payload["title"] === "string")
        patch["title"] = String(payload["title"]).slice(0, 120);
      if (typeof payload["description"] === "string")
        patch["description"] = String(payload["description"]).slice(0, 1000);
      if (typeof payload["rules"] === "string")
        patch["rules"] = String(payload["rules"]).slice(0, 2000);
      if (typeof payload["color"] === "string")
        patch["color"] = String(payload["color"]).slice(0, 32);
      if (typeof payload["capacity"] === "number") {
        patch["capacity"] = Math.min(
          Math.max(Math.trunc(payload["capacity"] as number), 2),
          limitOf(ctx, "room_members", 5),
        );
      }
      if (!Object.keys(patch).length) throw roomError("INVALID_INPUT");
      await db.from("rooms").update(patch).eq("id", room.id);
      return finish("Raum aktualisiert.");
    }
    case "archive": {
      await db.from("rooms").update({ archived_at: new Date().toISOString() }).eq("id", room.id);
      return finish("Raum archiviert.");
    }
    case "delete": {
      // Content is removed with the room; storage objects are swept by the cleanup job.
      await db.from("rooms").delete().eq("id", room.id);
      return finish("Raum und Inhalte wurden gelöscht.");
    }
    case "change_visibility": {
      const visibility = String(payload["visibility"] ?? "");
      if (!["public", "private", "invite", "paid"].includes(visibility))
        throw roomError("INVALID_INPUT");
      if (visibility === "paid" && !ctx.entitlements["paid_rooms"])
        throw roomError("PLAN_REQUIRED");
      await db.from("rooms").update({ visibility }).eq("id", room.id);
      return finish(`Sichtbarkeit auf «${visibility}» gesetzt.`);
    }
    case "update_retention": {
      const texts = Number(payload["retention_texts"] ?? room.retention_texts ?? 7);
      const images = Number(payload["retention_images"] ?? room.retention_images ?? 3);
      // Platform safety limits: never above the plan allowance.
      await db
        .from("rooms")
        .update({
          retention_texts: Math.min(
            Math.max(Math.trunc(texts), 1),
            limitOf(ctx, "retention_texts", 7),
          ),
          retention_images: Math.min(
            Math.max(Math.trunc(images), 0),
            limitOf(ctx, "retention_images", 3),
          ),
        })
        .eq("id", room.id);
      return finish("Aufbewahrung aktualisiert.");
    }
    case "assign_moderator":
    case "remove_moderator": {
      requireEntitlement(ctx, "moderators");
      const alias = sanitizeAlias(String(payload["member_alias"] ?? ""));
      if (!alias) throw roomError("INVALID_INPUT");
      const { data: member } = await db
        .from("memberships")
        .select("id, role")
        .eq("room_id", room.id)
        .eq("alias", alias)
        .is("left_at", null)
        .maybeSingle();
      if (!member) throw roomError("NOT_FOUND");
      if ((member as any).role === "owner") throw roomError("FORBIDDEN");
      await db
        .from("memberships")
        .update({ role: action === "assign_moderator" ? "moderator" : "participant" })
        .eq("id", (member as any).id);
      return finish(
        action === "assign_moderator"
          ? `${alias} ist jetzt Moderator:in.`
          : `${alias} moderiert nicht mehr.`,
      );
    }
    default:
      throw roomError("INVALID_INPUT");
  }
}

/* ------------------------------ invitations ------------------------------ */

async function hashToken(token: string): Promise<string> {
  return hmacSha256Hex(requireSecret("MESSAGE_ID_SECRET"), `invite:${token}`);
}

export async function createInvitation(
  db: Db,
  ctx: AccountContext,
  roomId: string,
  options: { expiresInHours?: number; maxUses?: number },
) {
  requireEntitlement(ctx, "invitations");
  requireWritablePaidFeatures(ctx);
  const room = await loadOwnedRoom(db, ctx, roomId);

  const token = `inv_${randomId(24)}`;
  const expiresAt = options.expiresInHours
    ? new Date(Date.now() + Math.min(options.expiresInHours, 24 * 30) * 3600 * 1000).toISOString()
    : null;

  const { error } = await db.from("invitations").insert({
    room_id: room.id,
    created_by_account_id: ctx.accountId,
    token_hash: await hashToken(token),
    max_uses: options.maxUses && options.maxUses > 0 ? Math.trunc(options.maxUses) : null,
    expires_at: expiresAt,
  });
  if (error) throw roomError("INTERNAL_ERROR");

  await audit(db, {
    actorType: "user",
    actorId: ctx.accountId,
    action: "invitation.create",
    targetType: "room",
    targetId: room.id,
  });

  return { invitation_token: token, expires_at: expiresAt, max_uses: options.maxUses ?? null };
}

export async function revokeInvitation(db: Db, ctx: AccountContext, token: string) {
  const tokenHash = await hashToken(token);
  const { data: invitation } = await db
    .from("invitations")
    .select("id, room_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!invitation) throw roomError("NOT_FOUND");
  await loadOwnedRoom(db, ctx, (invitation as any).room_id);
  await db
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", (invitation as any).id);
  return { revoked: true };
}

/** Redeems an invitation and joins the room. Idempotent for existing members. */
export async function acceptInvitation(
  db: Db,
  subjectHash: string,
  accountId: string,
  token: string,
) {
  const tokenHash = await hashToken(token);
  const { data: invitation } = await db
    .from("invitations")
    .select("id, room_id, max_uses, used_count, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!invitation) throw roomError("NOT_FOUND");
  const inv = invitation as any;
  if (inv.revoked_at) throw roomError("FORBIDDEN");
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now())
    throw roomError("FORBIDDEN");
  if (inv.max_uses !== null && inv.used_count >= inv.max_uses) throw roomError("FORBIDDEN");

  const { data: room } = await db
    .from("rooms")
    .select(ROOM_COLUMNS)
    .eq("id", inv.room_id)
    .maybeSingle();
  if (!room || (room as any).archived_at) throw roomError("NOT_FOUND");

  const { data: existing } = await db
    .from("memberships")
    .select("id, alias")
    .eq("room_id", inv.room_id)
    .eq("subject_hash", subjectHash)
    .is("left_at", null)
    .maybeSingle();

  if (existing) {
    return {
      room: room as unknown as OwnedRoom,
      alias: (existing as any).alias,
      joined_now: false,
    };
  }

  const alias = generateAlias(subjectHash + inv.room_id);
  const { error } = await db.from("memberships").insert({
    topic_id: (room as any).topic_id,
    room_id: inv.room_id,
    subject_hash: subjectHash,
    account_id: accountId,
    alias,
  });
  if (error) throw roomError("ROOM_UNAVAILABLE");

  await db
    .from("invitations")
    .update({ used_count: inv.used_count + 1 })
    .eq("id", inv.id);

  return { room: room as unknown as OwnedRoom, alias, joined_now: true };
}
