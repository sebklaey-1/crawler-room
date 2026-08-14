/**
 * MCP tools for plans, owned rooms, the Universal Room and advertising.
 *
 * Every handler derives identity from MCP `_meta`, resolves entitlements
 * server-side and refuses anything the plan, role or ownership does not allow.
 */
import { z } from "zod";

import {
  adminReviewCampaign,
  campaignAnalytics,
  createCampaign,
  hideCampaign,
  manageCampaign,
  reportCampaign,
  resolveCampaignId,
  submitCampaignForReview,
} from "./ads";
import { sanitizeAlias } from "./alias";
import { createCheckoutSession, createPortalSession } from "./billing";
import { roomError } from "./errors";
import {
  currentUsage,
  requireEntitlement,
  resolveEntitlements,
  upgradeOptions,
  type AccountContext,
} from "./entitlements";
import { resolveIdentity, type McpMeta } from "./identity";
import { encodeRoomId, decodeRoomId } from "./ids";
import { listPlans } from "./plans";
import {
  acceptInvitation,
  createInvitation,
  createOwnedRoom,
  manageRoom,
  revokeInvitation,
} from "./privaterooms";
import { getDb, type Db } from "./store";
import {
  enterUniversal,
  presenceLabel,
  sendUniversalMessage,
  universalFeed,
} from "./universal";

const REPORT_REASONS = [
  "spam",
  "misleading",
  "offensive",
  "scam",
  "irrelevant",
  "other",
] as const;

export const plusInputSchemas = {
  get_my_plan: z.object({}).strict(),
  create_checkout_link: z.object({ plan: z.enum(["plus", "pro", "business"]) }).strict(),
  open_billing_portal: z.object({}).strict(),
  create_private_room: z
    .object({
      title: z.string().min(2).max(120),
      description: z.string().max(1000).optional(),
      topic: z.string().max(64).optional(),
      visibility: z.enum(["public", "private", "invite", "paid"]).default("private"),
      capacity: z.number().int().min(2).max(5000).optional(),
      organization_id: z.string().uuid().optional(),
    })
    .strict(),
  manage_room: z
    .object({
      room_id: z.string().min(1),
      action: z.enum([
        "update",
        "archive",
        "delete",
        "change_visibility",
        "update_retention",
        "assign_moderator",
        "remove_moderator",
      ]),
      payload: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  create_invitation: z
    .object({
      room_id: z.string().min(1),
      expires_in_hours: z.number().int().min(1).max(720).optional(),
      max_uses: z.number().int().min(1).max(10000).optional(),
      revoke_token: z.string().optional(),
    })
    .strict(),
  join_invitation: z.object({ invitation_token: z.string().min(8) }).strict(),
  list_universal: z
    .object({
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      topic: z.string().max(64).optional(),
    })
    .strict(),
  enter_universal: z.object({ alias: z.string().optional() }).strict(),
  send_universal_message: z
    .object({ text: z.string(), idempotency_key: z.string().max(80).optional() })
    .strict(),
  create_sponsored_campaign: z
    .object({
      organization_id: z.string().uuid(),
      title: z.string().min(3).max(120),
      description: z.string().min(10).max(1000),
      topics: z.array(z.string().max(64)).min(1).max(10),
      cover_image_reference: z.string().max(300).optional(),
      call_to_action: z.string().max(60).optional(),
      destination_url: z.string().url().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      budget_cents: z.number().int().min(0).optional(),
      languages: z.array(z.string().max(8)).max(10).optional(),
    })
    .strict(),
  submit_campaign_for_review: z.object({ campaign_id: z.string().min(1) }).strict(),
  manage_campaign: z
    .object({
      campaign_id: z.string().min(1),
      action: z.enum(["update", "pause", "resume", "cancel"]),
      payload: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  get_campaign_analytics: z.object({ organization_id: z.string().uuid() }).strict(),
  hide_sponsored_placement: z.object({ campaign_id: z.string().min(1) }).strict(),
  report_sponsored_placement: z
    .object({ campaign_id: z.string().min(1), reason: z.enum(REPORT_REASONS) })
    .strict(),
  admin_review_campaign: z
    .object({
      campaign_id: z.string().min(1),
      action: z.enum(["approve", "reject", "request_changes", "suspend"]),
      reason: z.string().max(500).optional(),
    })
    .strict(),
};

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) throw roomError("INVALID_INPUT");
  return result.data;
}

async function context(meta: McpMeta): Promise<{ db: Db; ctx: AccountContext }> {
  const identity = await resolveIdentity(meta);
  const db = await getDb();
  const ctx = await resolveEntitlements(db, identity.subjectHash);
  return { db, ctx };
}

/* ------------------------------- plan tool ------------------------------- */

export async function handleGetMyPlan(input: unknown, meta: McpMeta) {
  parse(plusInputSchemas.get_my_plan, input);
  const { db, ctx } = await context(meta);
  const usage = await currentUsage(db, ctx);
  return {
    plan: { code: ctx.plan.code, name: ctx.plan.name, tagline: ctx.plan.tagline ?? "" },
    subscription_status: ctx.status,
    read_only_paid_features: ctx.readOnlyPaidFeatures,
    cancel_at_period_end: ctx.cancelAtPeriodEnd,
    current_period_end: ctx.currentPeriodEnd,
    entitlements: ctx.entitlements,
    limits: ctx.limits,
    usage,
    upgrade_options: await upgradeOptions(db, ctx),
    notice: "Reden, Lesen und Bilder teilen in öffentlichen Räumen bleibt in jedem Fall kostenlos.",
  };
}

export async function handlePublicPlans() {
  const db = await getDb();
  const plans = await listPlans(db);
  return {
    plans: plans.map((plan) => ({
      code: plan.code,
      name: plan.name,
      tagline: plan.tagline ?? "",
      price_cents: plan.price_cents,
      currency: plan.currency,
      interval: plan.interval,
      limits: plan.limits,
      entitlements: plan.entitlements,
    })),
  };
}

/* ------------------------------ owned rooms ------------------------------ */

export async function handleCreatePrivateRoom(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.create_private_room, input);
  const { db, ctx } = await context(meta);

  const room = await createOwnedRoom(db, ctx, {
    title: data.title,
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.topic !== undefined ? { topic: data.topic } : {}),
    visibility: data.visibility,
    ...(data.capacity !== undefined ? { capacity: data.capacity } : {}),
    ...(data.organization_id !== undefined ? { organizationId: data.organization_id } : {}),
  });

  const invitation = ctx.entitlements["invitations"]
    ? await createInvitation(db, ctx, room.id, { expiresInHours: 168 })
    : null;

  return {
    room_id: await encodeRoomId(room.id),
    title: room.title,
    visibility: room.visibility,
    capacity: room.capacity,
    retention: { texts: room.retention_texts, images: room.retention_images },
    invitation_token: invitation?.invitation_token ?? null,
    message: `Raum «${room.title}» wurde erstellt.`,
  };
}

export async function handleManageRoom(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.manage_room, input);
  const { db, ctx } = await context(meta);
  const roomId = await decodeRoomId(data.room_id);
  if (!roomId) throw roomError("NOT_FOUND");
  return manageRoom(db, ctx, roomId, data.action, data.payload ?? {});
}

export async function handleCreateInvitation(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.create_invitation, input);
  const { db, ctx } = await context(meta);

  if (data.revoke_token) {
    await revokeInvitation(db, ctx, data.revoke_token);
    return { revoked: true, message: "Einladung wurde widerrufen." };
  }

  const roomId = await decodeRoomId(data.room_id);
  if (!roomId) throw roomError("NOT_FOUND");
  const invitation = await createInvitation(db, ctx, roomId, {
    ...(data.expires_in_hours !== undefined ? { expiresInHours: data.expires_in_hours } : {}),
    ...(data.max_uses !== undefined ? { maxUses: data.max_uses } : {}),
  });
  return { ...invitation, message: "Teile diesen Einladungscode nur mit Personen, die du kennst." };
}

export async function handleJoinInvitation(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.join_invitation, input);
  const { db, ctx } = await context(meta);
  const result = await acceptInvitation(db, ctx.subjectHash, ctx.accountId, data.invitation_token);
  return {
    room_id: await encodeRoomId(result.room.id),
    title: result.room.title,
    alias: result.alias,
    joined_now: result.joined_now,
    message: result.joined_now ? `Du bist «${result.room.title}» beigetreten.` : "Du bist bereits Mitglied.",
  };
}

/* ----------------------------- universal room ----------------------------- */

export async function handleEnterUniversal(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.enter_universal, input);
  const { db, ctx } = await context(meta);

  let alias: string | null = ctx.customAlias;
  if (data.alias) {
    requireEntitlement(ctx, "custom_alias");
    alias = sanitizeAlias(data.alias);
    if (alias) {
      await db.from("anonymous_identities").update({ custom_alias: alias }).eq("subject_hash", ctx.subjectHash);
    }
  }

  const membership = await enterUniversal(db, ctx.subjectHash, alias);
  const feed = await universalFeed(db, ctx.subjectHash, membership, { limit: 20 });
  const presence = presenceLabel(membership.presence);

  return {
    joined_now: membership.joinedNow,
    alias: membership.alias,
    presence: presence.bucket,
    ...feed,
  };
}

export async function handleListUniversal(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.list_universal, input);
  const { db, ctx } = await context(meta);
  const membership = await enterUniversal(db, ctx.subjectHash, ctx.customAlias);
  return universalFeed(db, ctx.subjectHash, membership, {
    cursor: data.cursor ?? null,
    ...(data.limit !== undefined ? { limit: data.limit } : {}),
    topic: data.topic ?? null,
  });
}

export async function handleSendUniversalMessage(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.send_universal_message, input);
  const { db, ctx } = await context(meta);
  const membership = await enterUniversal(db, ctx.subjectHash, ctx.customAlias);
  const sent = await sendUniversalMessage(
    db,
    ctx.subjectHash,
    membership,
    data.text,
    data.idempotency_key ?? null,
  );
  const feed = await universalFeed(db, ctx.subjectHash, membership, { limit: 20 });
  return { sent: true, duplicate: sent.duplicate, sent_message: sent.message, ...feed };
}

/* ------------------------------- campaigns ------------------------------- */

export async function handleCreateSponsoredCampaign(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.create_sponsored_campaign, input);
  const { db, ctx } = await context(meta);
  const result = await createCampaign(db, ctx, {
    organizationId: data.organization_id,
    title: data.title,
    description: data.description,
    topics: data.topics,
    ...(data.cover_image_reference !== undefined ? { coverPath: data.cover_image_reference } : {}),
    ...(data.call_to_action !== undefined ? { ctaLabel: data.call_to_action } : {}),
    ...(data.destination_url !== undefined ? { ctaUrl: data.destination_url } : {}),
    ...(data.start_date !== undefined ? { startsAt: data.start_date } : {}),
    ...(data.end_date !== undefined ? { endsAt: data.end_date } : {}),
    ...(data.budget_cents !== undefined ? { budgetCents: data.budget_cents } : {}),
    ...(data.languages !== undefined ? { languages: data.languages } : {}),
  });
  return {
    ...result,
    message:
      "Kampagne als Entwurf angelegt. Sie wird erst nach Prüfung und Freigabe sichtbar und immer als Anzeige gekennzeichnet.",
  };
}

export async function handleSubmitCampaignForReview(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.submit_campaign_for_review, input);
  const { db, ctx } = await context(meta);
  return submitCampaignForReview(db, ctx, await resolveCampaignId(data.campaign_id));
}

export async function handleManageCampaign(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.manage_campaign, input);
  const { db, ctx } = await context(meta);
  return manageCampaign(db, ctx, await resolveCampaignId(data.campaign_id), data.action, data.payload ?? {});
}

export async function handleGetCampaignAnalytics(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.get_campaign_analytics, input);
  const { db, ctx } = await context(meta);
  return campaignAnalytics(db, ctx, data.organization_id);
}

export async function handleHideSponsoredPlacement(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.hide_sponsored_placement, input);
  const { db, ctx } = await context(meta);
  return hideCampaign(db, ctx.subjectHash, await resolveCampaignId(data.campaign_id));
}

export async function handleReportSponsoredPlacement(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.report_sponsored_placement, input);
  const { db, ctx } = await context(meta);
  return reportCampaign(db, ctx.subjectHash, await resolveCampaignId(data.campaign_id), data.reason);
}

export async function handleAdminReviewCampaign(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.admin_review_campaign, input);
  const { db, ctx } = await context(meta);
  const result = await adminReviewCampaign(
    db,
    ctx,
    await resolveCampaignId(data.campaign_id),
    data.action,
    data.reason,
  );
  return { ...result, message: `Kampagne: ${result.status}.` };
}

/* -------------------------------- billing -------------------------------- */

function originFrom(meta: McpMeta): string {
  const origin = (meta as Record<string, unknown> | undefined)?.["room/origin"];
  return typeof origin === "string" && origin ? origin : "https://zinga-room.lovable.app";
}

export async function handleCreateCheckoutLink(input: unknown, meta: McpMeta) {
  const data = parse(plusInputSchemas.create_checkout_link, input);
  const { db, ctx } = await context(meta);
  const session = await createCheckoutSession(db, ctx, data.plan, originFrom(meta));
  return {
    checkout_url: session.url,
    plan: data.plan,
    message: "Sichere Stripe-Kasse geöffnet. Reden und Lesen bleibt auch ohne Abo kostenlos.",
  };
}

export async function handleOpenBillingPortal(input: unknown, meta: McpMeta) {
  parse(plusInputSchemas.open_billing_portal, input);
  const { db, ctx } = await context(meta);
  const session = await createPortalSession(db, ctx, originFrom(meta));
  return { portal_url: session.url, message: "Verwalte dein Abo im sicheren Stripe-Portal." };
}
