/**
 * Sponsored Rooms and advertising.
 *
 * Rules enforced here:
 * - advertising only ever appears in dedicated Universal Room placements;
 * - a campaign is visible only after human/platform approval;
 * - targeting uses the publicly browsed topic only — never private content;
 * - per-user frequency caps and hides are honoured server-side;
 * - analytics are aggregated and gated by a minimum threshold.
 */
import { audit, recordModeration } from "./audit";
import { roomError } from "./errors";
import {
  requireEntitlement,
  requireOrganizationAccess,
  requireWritablePaidFeatures,
  type AccountContext,
} from "./entitlements";
import { encodeCampaignId, decodeCampaignId } from "./ids";
import { adSettings } from "./plans";
import type { Db } from "./store";

const CAMPAIGN_COLUMNS =
  "id, organization_id, room_id, title, description, cover_path, cta_label, cta_url, topics, languages, starts_at, ends_at, status, safety_status, rejection_reason, created_at";

/** Content that may never be advertised on @room. */
const PROHIBITED_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "sexual_services",
    pattern: /\b(escort|sexcam|porn|onlyfans|erotik|sexual services)\b/i,
  },
  { label: "minor_safety", pattern: /\b(teen sex|minderj[aä]hrig|child|loli)\b/i },
  { label: "hate", pattern: /\b(white power|heil hitler|rassenkrieg|jihadi)\b/i },
  { label: "violence", pattern: /\b(gore|beheading|snuff|killing videos)\b/i },
  { label: "weapons", pattern: /\b(buy guns?|ammo for sale|waffen kaufen|silencer)\b/i },
  { label: "drugs", pattern: /\b(cocaine|mdma|meth|heroin|kokain|weed for sale)\b/i },
  {
    label: "scam",
    pattern: /\b(guaranteed returns?|double your money|risikofrei reich|get rich quick)\b/i,
  },
  { label: "malware", pattern: /\b(keygen|crack download|rat trojan|malware)\b/i },
  { label: "health_claims", pattern: /\b(cure cancer|miracle cure|wunderheilung|covid cure)\b/i },
  {
    label: "investment_guarantee",
    pattern: /\b(guaranteed profit|garantierte rendite|100% roi)\b/i,
  },
  { label: "political", pattern: /\b(vote for|w[aä]hlt |election campaign|parteiwerbung)\b/i },
  { label: "sensitive_data", pattern: /\b(buy leads|sell personal data|kreditkartendaten)\b/i },
];

export interface PolicyResult {
  ok: boolean;
  violations: string[];
}

export function screenCampaignCopy(input: {
  title: string;
  description: string;
  ctaLabel?: string | null | undefined;
  ctaUrl?: string | null | undefined;
  organizationName?: string | null | undefined;
}): PolicyResult {
  const haystack = [input.title, input.description, input.ctaLabel, input.organizationName]
    .filter(Boolean)
    .join("\n");
  const violations = PROHIBITED_PATTERNS.filter((rule) => rule.pattern.test(haystack)).map(
    (rule) => rule.label,
  );

  if (input.ctaUrl) {
    try {
      const url = new URL(input.ctaUrl);
      if (url.protocol !== "https:") violations.push("insecure_destination");
      if (PROHIBITED_PATTERNS.some((rule) => rule.pattern.test(url.hostname + url.pathname))) {
        violations.push("unsafe_destination");
      }
    } catch {
      violations.push("invalid_destination");
    }
  }

  return { ok: violations.length === 0, violations };
}

/* ------------------------------- campaigns ------------------------------- */

async function requireBusinessOrg(db: Db, ctx: AccountContext, organizationId: string) {
  requireEntitlement(ctx, "campaigns");
  requireWritablePaidFeatures(ctx);
  const org = await requireOrganizationAccess(db, ctx, organizationId);
  if (org.suspended) throw roomError("FORBIDDEN");
  return org;
}

export async function createCampaign(
  db: Db,
  ctx: AccountContext,
  input: {
    organizationId: string;
    title: string;
    description: string;
    topics: string[];
    coverPath?: string;
    ctaLabel?: string;
    ctaUrl?: string;
    startsAt?: string;
    endsAt?: string;
    budgetCents?: number;
    languages?: string[];
  },
) {
  const org = await requireBusinessOrg(db, ctx, input.organizationId);

  const policy = screenCampaignCopy({
    title: input.title,
    description: input.description,
    ctaLabel: input.ctaLabel,
    ctaUrl: input.ctaUrl,
    organizationName: org.name,
  });

  const { data, error } = await db
    .from("sponsored_campaigns")
    .insert({
      organization_id: org.id,
      title: input.title.slice(0, 120),
      description: input.description.slice(0, 1000),
      cover_path: input.coverPath ?? null,
      cta_label: input.ctaLabel?.slice(0, 60) ?? null,
      cta_url: input.ctaUrl ?? null,
      topics: input.topics.slice(0, 10),
      languages: (input.languages ?? ["de", "en"]).slice(0, 10),
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
      status: "draft",
      safety_status: policy.ok ? "unreviewed" : "fail",
    })
    .select(CAMPAIGN_COLUMNS)
    .single();
  if (error || !data) throw roomError("CAMPAIGN_INVALID");

  const campaign = data as any;

  await db.from("campaign_budgets").insert({
    campaign_id: campaign.id,
    total_budget_cents: Math.max(0, Math.trunc(input.budgetCents ?? 0)),
    cost_per_entry_cents: (await adSettings(db)).default_cost_per_entry_cents,
  });

  if (!policy.ok) {
    await recordModeration(db, {
      subjectType: "campaign",
      subjectId: campaign.id,
      decision: "rejected",
      reason: policy.violations.join(","),
    });
  }

  await audit(db, {
    actorType: "organization",
    actorId: org.id,
    action: "campaign.create",
    targetType: "campaign",
    targetId: campaign.id,
  });

  return {
    campaign_id: await encodeCampaignId(campaign.id),
    status: campaign.status,
    policy_ok: policy.ok,
    policy_violations: policy.violations,
  };
}

async function loadOwnedCampaign(db: Db, ctx: AccountContext, campaignId: string) {
  const { data } = await db
    .from("sponsored_campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("id", campaignId)
    .maybeSingle();
  if (!data) throw roomError("NOT_FOUND");
  await requireOrganizationAccess(db, ctx, (data as any).organization_id);
  return data as any;
}

export async function submitCampaignForReview(db: Db, ctx: AccountContext, campaignId: string) {
  const campaign = await loadOwnedCampaign(db, ctx, campaignId);
  const org = await requireBusinessOrg(db, ctx, campaign.organization_id);

  if (!org.verified) throw roomError("ORGANIZATION_REQUIRED");
  if (!campaign.title || !campaign.description || !campaign.topics?.length || !campaign.ends_at) {
    throw roomError("CAMPAIGN_INVALID");
  }
  if (!["draft", "rejected"].includes(campaign.status)) throw roomError("CAMPAIGN_INVALID");

  const { data: budget } = await db
    .from("campaign_budgets")
    .select("total_budget_cents")
    .eq("campaign_id", campaign.id)
    .maybeSingle();
  if (!budget || (budget as any).total_budget_cents <= 0) throw roomError("BILLING_REQUIRED");

  const policy = screenCampaignCopy({
    title: campaign.title,
    description: campaign.description,
    ctaLabel: campaign.cta_label,
    ctaUrl: campaign.cta_url,
    organizationName: org.name,
  });
  if (!policy.ok) {
    await db
      .from("sponsored_campaigns")
      .update({ safety_status: "fail", rejection_reason: policy.violations.join(",") })
      .eq("id", campaign.id);
    throw roomError("POLICY_VIOLATION", undefined, { violations: policy.violations });
  }

  await db
    .from("sponsored_campaigns")
    .update({ status: "pending_review", safety_status: "unreviewed", rejection_reason: null })
    .eq("id", campaign.id);

  await audit(db, {
    actorType: "organization",
    actorId: org.id,
    action: "campaign.submit",
    targetType: "campaign",
    targetId: campaign.id,
  });

  return { status: "pending_review", message: "Kampagne wurde zur Prüfung eingereicht." };
}

export async function manageCampaign(
  db: Db,
  ctx: AccountContext,
  campaignId: string,
  action: "update" | "pause" | "resume" | "cancel",
  payload: Record<string, unknown> = {},
) {
  const campaign = await loadOwnedCampaign(db, ctx, campaignId);
  await requireBusinessOrg(db, ctx, campaign.organization_id);

  switch (action) {
    case "update": {
      if (!["draft", "rejected", "paused"].includes(campaign.status))
        throw roomError("CAMPAIGN_INVALID");
      const patch: Record<string, unknown> = {};
      for (const key of ["title", "description", "cta_label", "cta_url"]) {
        if (typeof payload[key] === "string") patch[key] = String(payload[key]).slice(0, 1000);
      }
      if (Array.isArray(payload["topics"]))
        patch["topics"] = (payload["topics"] as string[]).slice(0, 10);
      if (typeof payload["ends_at"] === "string") patch["ends_at"] = payload["ends_at"];
      if (!Object.keys(patch).length) throw roomError("INVALID_INPUT");
      // Any content change forces a fresh review.
      patch["status"] = "draft";
      patch["safety_status"] = "unreviewed";
      await db.from("sponsored_campaigns").update(patch).eq("id", campaign.id);
      break;
    }
    case "pause": {
      if (!["approved", "active"].includes(campaign.status)) throw roomError("CAMPAIGN_INVALID");
      await db.from("sponsored_campaigns").update({ status: "paused" }).eq("id", campaign.id);
      break;
    }
    case "resume": {
      if (campaign.status !== "paused") throw roomError("CAMPAIGN_INVALID");
      await db.from("sponsored_campaigns").update({ status: "active" }).eq("id", campaign.id);
      break;
    }
    case "cancel": {
      await db.from("sponsored_campaigns").update({ status: "completed" }).eq("id", campaign.id);
      break;
    }
    default:
      throw roomError("INVALID_INPUT");
  }

  await audit(db, {
    actorType: "organization",
    actorId: campaign.organization_id,
    action: `campaign.${action}`,
    targetType: "campaign",
    targetId: campaign.id,
  });

  return {
    campaign_id: await encodeCampaignId(campaign.id),
    action,
    message: "Kampagne aktualisiert.",
  };
}

/* ------------------------------- placements ------------------------------- */

export interface PlacementCard {
  placement_id: string;
  campaign_id: string;
  label: string;
  organization: string;
  verified: boolean;
  title: string;
  description: string;
  cta_label: string | null;
  cta_url: string | null;
  topics: string[];
  disclosure: string;
}

/**
 * Contextual selection uses only the publicly browsed topic.
 * Private room content is never read for targeting.
 */
export async function selectPlacements(
  db: Db,
  subjectHash: string,
  options: { topic?: string | null; limit?: number },
): Promise<PlacementCard[]> {
  const settings = await adSettings(db);
  const limit = Math.min(
    options.limit ?? settings.max_placements_per_page,
    settings.max_placements_per_page,
  );
  if (limit <= 0) return [];

  const nowIso = new Date().toISOString();
  const { data } = await db
    .from("sponsored_campaigns")
    .select(`${CAMPAIGN_COLUMNS}, organizations(name, verified)`)
    .in("status", ["approved", "active"])
    .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
    .limit(50);

  const candidates = ((data ?? []) as any[]).filter((campaign) => {
    if (campaign.ends_at && new Date(campaign.ends_at).getTime() < Date.now()) return false;
    if (campaign.safety_status === "fail") return false;
    return true;
  });
  if (!candidates.length) return [];

  const ids = candidates.map((c) => c.id);
  const [{ data: hidden }, { data: impressions }, { data: budgets }] = await Promise.all([
    db
      .from("user_hidden_campaigns")
      .select("campaign_id")
      .eq("subject_hash", subjectHash)
      .in("campaign_id", ids),
    db
      .from("campaign_impression_log")
      .select("campaign_id, created_at")
      .eq("subject_hash", subjectHash)
      .in("campaign_id", ids)
      .gte("created_at", new Date(Date.now() - 3600 * 1000).toISOString()),
    db
      .from("campaign_budgets")
      .select("campaign_id, total_budget_cents, spent_cents")
      .in("campaign_id", ids),
  ]);

  const hiddenSet = new Set(((hidden ?? []) as any[]).map((row) => row.campaign_id));
  const seenCounts = new Map<string, number>();
  for (const row of (impressions ?? []) as any[]) {
    seenCounts.set(row.campaign_id, (seenCounts.get(row.campaign_id) ?? 0) + 1);
  }
  const exhausted = new Set(
    ((budgets ?? []) as any[])
      .filter((b) => b.total_budget_cents > 0 && b.spent_cents >= b.total_budget_cents)
      .map((b) => b.campaign_id),
  );

  const topic = options.topic?.toLowerCase() ?? null;
  const eligible = candidates
    .filter((campaign) => !hiddenSet.has(campaign.id))
    .filter((campaign) => !exhausted.has(campaign.id))
    .filter((campaign) => (seenCounts.get(campaign.id) ?? 0) < settings.frequency_cap_per_hour)
    .sort((a, b) => {
      const aMatch = topic && (a.topics ?? []).includes(topic) ? 1 : 0;
      const bMatch = topic && (b.topics ?? []).includes(topic) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return (seenCounts.get(a.id) ?? 0) - (seenCounts.get(b.id) ?? 0);
    })
    .slice(0, limit);

  const cards: PlacementCard[] = [];
  for (const campaign of eligible) {
    cards.push({
      placement_id: await encodeCampaignId(campaign.id),
      campaign_id: await encodeCampaignId(campaign.id),
      label: "Gesponserter Raum",
      organization: campaign.organizations?.name ?? "Organisation",
      verified: Boolean(campaign.organizations?.verified),
      title: campaign.title,
      description: campaign.description,
      cta_label: campaign.cta_label,
      cta_url: campaign.cta_url,
      topics: campaign.topics ?? [],
      disclosure: "Sponsored · Anzeige — du entscheidest selbst, ob du diesen Raum betrittst.",
    });
  }

  if (cards.length)
    await recordImpressions(
      db,
      subjectHash,
      eligible.map((c) => c.id),
    );
  return cards;
}

async function recordImpressions(db: Db, subjectHash: string, campaignIds: string[]) {
  await db
    .from("campaign_impression_log")
    .insert(campaignIds.map((campaign_id) => ({ campaign_id, subject_hash: subjectHash })));
  for (const campaignId of campaignIds) await bumpMetric(db, campaignId, "impressions", 1);
}

export async function bumpMetric(
  db: Db,
  campaignId: string,
  field: "impressions" | "entries" | "cta_clicks" | "event_signups" | "hides" | "reports",
  amount = 1,
  spendCents = 0,
) {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await db
    .from("campaign_metrics")
    .select("id, impressions, entries, cta_clicks, event_signups, hides, reports, spend_cents")
    .eq("campaign_id", campaignId)
    .eq("day", day)
    .maybeSingle();

  if (!data) {
    await db.from("campaign_metrics").insert({
      campaign_id: campaignId,
      day,
      [field]: amount,
      spend_cents: spendCents,
    });
  } else {
    await db
      .from("campaign_metrics")
      .update({
        [field]: ((data as any)[field] ?? 0) + amount,
        spend_cents: ((data as any).spend_cents ?? 0) + spendCents,
      })
      .eq("id", (data as any).id);
  }

  if (spendCents > 0) {
    const { data: budget } = await db
      .from("campaign_budgets")
      .select("id, spent_cents")
      .eq("campaign_id", campaignId)
      .maybeSingle();
    if (budget) {
      await db
        .from("campaign_budgets")
        .update({ spent_cents: ((budget as any).spent_cents ?? 0) + spendCents })
        .eq("id", (budget as any).id);
    }
  }
}

/** A voluntary entry into a sponsored room; billed per entry. */
export async function recordSponsoredEntry(db: Db, campaignId: string) {
  const { data: budget } = await db
    .from("campaign_budgets")
    .select("cost_per_entry_cents")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  await bumpMetric(db, campaignId, "entries", 1, (budget as any)?.cost_per_entry_cents ?? 0);
}

export async function hideCampaign(db: Db, subjectHash: string, campaignId: string) {
  await db
    .from("user_hidden_campaigns")
    .upsert(
      { subject_hash: subjectHash, campaign_id: campaignId },
      { onConflict: "subject_hash,campaign_id" },
    );
  await bumpMetric(db, campaignId, "hides", 1);
  return { hidden: true, message: "Diese Anzeige wird dir nicht mehr angezeigt." };
}

export async function reportCampaign(
  db: Db,
  subjectHash: string,
  campaignId: string,
  reason: string,
) {
  await db.from("message_reports").insert({
    campaign_id: campaignId,
    reporter_subject_hash: subjectHash,
    reason,
  });
  await bumpMetric(db, campaignId, "reports", 1);
  await recordModeration(db, {
    subjectType: "campaign",
    subjectId: campaignId,
    decision: "escalated",
    source: "automated",
    reason,
  });
  return { reported: true, message: "Danke. Die Anzeige wurde zur Prüfung gemeldet." };
}

/* ------------------------------- analytics ------------------------------- */

export async function campaignAnalytics(db: Db, ctx: AccountContext, organizationId: string) {
  requireEntitlement(ctx, "campaigns");
  await requireOrganizationAccess(db, ctx, organizationId);
  const settings = await adSettings(db);

  const { data: campaigns } = await db
    .from("sponsored_campaigns")
    .select("id, title, status")
    .eq("organization_id", organizationId);

  const results = [];
  for (const campaign of (campaigns ?? []) as any[]) {
    const { data: metrics } = await db
      .from("campaign_metrics")
      .select("impressions, entries, cta_clicks, event_signups, hides, reports, spend_cents")
      .eq("campaign_id", campaign.id);

    const totals = ((metrics ?? []) as any[]).reduce(
      (acc, row) => ({
        impressions: acc.impressions + (row.impressions ?? 0),
        entries: acc.entries + (row.entries ?? 0),
        cta_clicks: acc.cta_clicks + (row.cta_clicks ?? 0),
        event_signups: acc.event_signups + (row.event_signups ?? 0),
        hides: acc.hides + (row.hides ?? 0),
        reports: acc.reports + (row.reports ?? 0),
        spend_cents: acc.spend_cents + (row.spend_cents ?? 0),
      }),
      {
        impressions: 0,
        entries: 0,
        cta_clicks: 0,
        event_signups: 0,
        hides: 0,
        reports: 0,
        spend_cents: 0,
      },
    );

    // Minimum aggregation threshold: never expose small-sample behaviour.
    const belowThreshold = totals.impressions < settings.min_aggregation_threshold;
    results.push({
      campaign_id: await encodeCampaignId(campaign.id),
      title: campaign.title,
      status: campaign.status,
      aggregated: !belowThreshold,
      impressions: belowThreshold ? null : totals.impressions,
      room_entries: belowThreshold ? null : totals.entries,
      cta_clicks: belowThreshold ? null : totals.cta_clicks,
      event_signups: belowThreshold ? null : totals.event_signups,
      hide_rate: belowThreshold || !totals.impressions ? null : totals.hides / totals.impressions,
      report_rate:
        belowThreshold || !totals.impressions ? null : totals.reports / totals.impressions,
      spend_cents: totals.spend_cents,
      cost_per_entry_cents: totals.entries ? Math.round(totals.spend_cents / totals.entries) : null,
      note: belowThreshold
        ? `Zu wenige Daten für eine datenschutzsichere Auswertung (Schwelle: ${settings.min_aggregation_threshold}).`
        : null,
    });
  }

  return { organization_id: organizationId, campaigns: results };
}

/* ----------------------------- admin review ----------------------------- */

export async function adminReviewCampaign(
  db: Db,
  ctx: AccountContext,
  campaignId: string,
  action: "approve" | "reject" | "request_changes" | "suspend",
  reason?: string,
) {
  if (!ctx.isPlatformAdmin) throw roomError("FORBIDDEN");

  const { data } = await db
    .from("sponsored_campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("id", campaignId)
    .maybeSingle();
  if (!data) throw roomError("NOT_FOUND");

  const statusByAction = {
    approve: "approved",
    reject: "rejected",
    request_changes: "draft",
    suspend: "suspended",
  } as const;

  await db
    .from("sponsored_campaigns")
    .update({
      status: statusByAction[action],
      safety_status: action === "approve" ? "pass" : action === "reject" ? "fail" : "unreviewed",
      rejection_reason: action === "approve" ? null : (reason ?? null),
    })
    .eq("id", campaignId);

  await db.from("campaign_reviews").insert({
    campaign_id: campaignId,
    reviewer_account_id: ctx.accountId,
    decision: action,
    reason: reason ?? null,
  });

  await recordModeration(db, {
    subjectType: "campaign",
    subjectId: campaignId,
    decision: action === "approve" ? "approved" : action === "suspend" ? "suspended" : "rejected",
    source: "human",
    reason,
    reviewerAccountId: ctx.accountId,
  });

  await audit(db, {
    actorType: "platform_admin",
    actorId: ctx.accountId,
    action: `campaign.review.${action}`,
    targetType: "campaign",
    targetId: campaignId,
  });

  return { campaign_id: await encodeCampaignId(campaignId), status: statusByAction[action] };
}

export async function resolveCampaignId(external: unknown): Promise<string> {
  const id = await decodeCampaignId(external);
  if (!id) throw roomError("NOT_FOUND");
  return id;
}
