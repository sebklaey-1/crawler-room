/**
 * Central entitlement service.
 *
 * SECURITY: the caller never sends plan, role or subscription information.
 * Everything is derived server-side from the pseudonymous identity
 * (HMAC of the MCP subject) and the database.
 */
import { roomError } from "./errors";
import { getPlanByCode, getPlanById, listPlans, type PlanRow } from "./plans";
import type { Db } from "./store";

export type SubscriptionStatus =
  | "free"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "expired";

/** Statuses that grant the full paid feature set. */
const FULL_ACCESS: SubscriptionStatus[] = ["trialing", "active", "past_due"];

export interface AccountContext {
  accountId: string;
  subjectHash: string;
  customAlias: string | null;
  plan: PlanRow;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  /** Grace period after expiry: paid rooms stay readable, management is read-only. */
  inGrace: boolean;
  readOnlyPaidFeatures: boolean;
  entitlements: Record<string, boolean>;
  limits: Record<string, number>;
  isPlatformAdmin: boolean;
  stripeCustomerId: string | null;
}

/** Ensures an account + anonymous identity record exists for this subject. */
export async function ensureAccount(db: Db, subjectHash: string): Promise<{ accountId: string; customAlias: string | null }> {
  const { data: existing, error } = await db
    .from("anonymous_identities")
    .select("account_id, custom_alias")
    .eq("subject_hash", subjectHash)
    .maybeSingle();
  if (error) throw roomError("INTERNAL_ERROR");

  if (existing && (existing as any).account_id) {
    await db
      .from("anonymous_identities")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("subject_hash", subjectHash);
    return { accountId: (existing as any).account_id, customAlias: (existing as any).custom_alias ?? null };
  }

  const { data: account, error: accountError } = await db
    .from("accounts")
    .insert({})
    .select("id")
    .single();
  if (accountError || !account) throw roomError("INTERNAL_ERROR");
  const accountId = (account as any).id as string;

  const { error: linkError } = await db
    .from("anonymous_identities")
    .upsert(
      { subject_hash: subjectHash, account_id: accountId, last_seen_at: new Date().toISOString() },
      { onConflict: "subject_hash" },
    );
  if (linkError) throw roomError("INTERNAL_ERROR");

  return { accountId, customAlias: (existing as any)?.custom_alias ?? null };
}

/** Full server-side entitlement snapshot. Never trust client-provided plans. */
export async function resolveEntitlements(db: Db, subjectHash: string): Promise<AccountContext> {
  const { accountId, customAlias } = await ensureAccount(db, subjectHash);

  const [{ data: subscription }, { data: account }, { data: roles }, { data: overrides }] =
    await Promise.all([
      db
        .from("subscriptions")
        .select("plan_id, status, cancel_at_period_end, current_period_end, grace_until")
        .eq("account_id", accountId)
        .maybeSingle(),
      db.from("accounts").select("stripe_customer_id").eq("id", accountId).maybeSingle(),
      db.from("platform_roles").select("role").eq("account_id", accountId),
      db
        .from("entitlement_overrides")
        .select("key, value, expires_at")
        .eq("account_id", accountId),
    ]);

  const freePlan = await getPlanByCode(db, "free");
  const sub = subscription as any;
  const status: SubscriptionStatus = "free";
  const inGrace = false;

  const effectivePlan = freePlan;

  // Everything is free: every feature of every tier is unlocked for everyone,
  // and every limit uses the most generous value in the catalogue.
  const allPlans = await listPlans(db);
  const entitlements: Record<string, boolean> = {};
  const limits: Record<string, number> = {};
  for (const plan of [freePlan, ...allPlans]) {
    for (const key of Object.keys(plan.entitlements ?? {})) entitlements[key] = true;
    for (const [key, value] of Object.entries(plan.limits ?? {})) {
      const current = limits[key];
      limits[key] = typeof current === "number" ? Math.max(current, value) : value;
    }
  }

  for (const row of (overrides ?? []) as any[]) {
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) continue;
    if (typeof row.value === "boolean") entitlements[row.key] = row.value;
    else if (typeof row.value === "number") limits[row.key] = Math.max(limits[row.key] ?? 0, row.value);
  }

  return {
    accountId,
    subjectHash,
    customAlias,
    plan: effectivePlan,
    status,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    inGrace,
    readOnlyPaidFeatures: false,
    entitlements,
    limits,
    isPlatformAdmin: ((roles ?? []) as any[]).some((r) => r.role === "platform_admin"),
    stripeCustomerId: (account as any)?.stripe_customer_id ?? null,
  };

}

export function requireEntitlement(ctx: AccountContext, key: string): void {
  if (!ctx.entitlements[key]) {
    throw roomError("PLAN_REQUIRED", undefined, { required_feature: key, current_plan: ctx.plan.code });
  }
}

export function requireWritablePaidFeatures(ctx: AccountContext): void {
  if (ctx.readOnlyPaidFeatures) throw roomError("SUBSCRIPTION_READ_ONLY");
}

export function limitOf(ctx: AccountContext, key: string, fallback = 0): number {
  const value = ctx.limits[key];
  return typeof value === "number" ? value : fallback;
}

export async function requireUnderLimit(
  ctx: AccountContext,
  key: string,
  current: number,
): Promise<void> {
  const max = limitOf(ctx, key, 0);
  if (current >= max) {
    throw roomError("LIMIT_REACHED", undefined, { limit: key, max, current_plan: ctx.plan.code });
  }
}

/** Usage counters shown in room_get_my_plan and the upgrade screen. */
export async function currentUsage(db: Db, ctx: AccountContext) {
  const [{ count: ownedRooms }, { count: activeMemberships }, { count: organizations }] =
    await Promise.all([
      db
        .from("rooms")
        .select("id", { count: "exact", head: true })
        .eq("owner_account_id", ctx.accountId)
        .is("archived_at", null),
      db
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("subject_hash", ctx.subjectHash)
        .is("left_at", null),
      db
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .eq("owner_account_id", ctx.accountId),
    ]);
  return {
    owned_rooms: ownedRooms ?? 0,
    active_memberships: activeMemberships ?? 0,
    organizations: organizations ?? 0,
  };
}

export async function upgradeOptions(db: Db, ctx: AccountContext) {
  const plans = await listPlans(db);
  return plans
    .filter((plan) => plan.sort_order > (ctx.plan.sort_order ?? 0))
    .map((plan) => ({
      code: plan.code,
      name: plan.name,
      tagline: plan.tagline ?? "",
      price_cents: plan.price_cents,
      currency: plan.currency,
      interval: plan.interval,
    }));
}

/* ------------------------------ organizations ----------------------------- */

export interface OrgContext {
  id: string;
  name: string;
  verified: boolean;
  billingReady: boolean;
  suspended: boolean;
  role: string;
}

export async function requireOrganizationAccess(
  db: Db,
  ctx: AccountContext,
  organizationId: string,
): Promise<OrgContext> {
  const { data: org } = await db
    .from("organizations")
    .select("id, name, verified, billing_ready, suspended_at, owner_account_id")
    .eq("id", organizationId)
    .maybeSingle();
  if (!org) throw roomError("NOT_FOUND");

  let role = (org as any).owner_account_id === ctx.accountId ? "organization_admin" : "";
  if (!role) {
    const { data: member } = await db
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    role = (member as any)?.role ?? "";
  }
  if (!role || (role !== "organization_admin" && role !== "moderator")) throw roomError("FORBIDDEN");

  return {
    id: (org as any).id,
    name: (org as any).name,
    verified: Boolean((org as any).verified),
    billingReady: Boolean((org as any).billing_ready),
    suspended: Boolean((org as any).suspended_at),
    role,
  };
}
