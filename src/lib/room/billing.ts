/**
 * Stripe subscriptions — server-side only.
 *
 * The Stripe secret key never leaves the server, webhook signatures are
 * verified, and every webhook is processed at most once (idempotency through
 * `webhook_events`).
 */
import { audit } from "./audit";
import { hmacSha256Hex, safeEqual } from "./crypto";
import { roomError } from "./errors";
import type { AccountContext } from "./entitlements";
import { getPlanByCode, graceSettings } from "./plans";
import type { Db } from "./store";

const STRIPE_API = "https://api.stripe.com/v1";

function stripeKey(): string {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw roomError("BILLING_REQUIRED");
  return key;
}

async function stripeRequest(path: string, body?: Record<string, string>): Promise<any> {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${stripeKey()}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    ...(body ? { body: new URLSearchParams(body).toString() } : {}),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw roomError("BILLING_REQUIRED");
  return json;
}

async function ensureCustomer(db: Db, ctx: AccountContext): Promise<string> {
  if (ctx.stripeCustomerId) return ctx.stripeCustomerId;
  const customer = await stripeRequest("/customers", {
    "metadata[account_id]": ctx.accountId,
  });
  await db.from("accounts").update({ stripe_customer_id: customer.id }).eq("id", ctx.accountId);
  return customer.id as string;
}

export async function createCheckoutSession(
  db: Db,
  ctx: AccountContext,
  planCode: string,
  origin: string,
): Promise<{ url: string }> {
  const plan = await getPlanByCode(db, planCode);
  if (!plan.stripe_price_id) throw roomError("BILLING_REQUIRED");
  const customer = await ensureCustomer(db, ctx);

  const session = await stripeRequest("/checkout/sessions", {
    mode: "subscription",
    customer,
    client_reference_id: ctx.accountId,
    "line_items[0][price]": plan.stripe_price_id,
    "line_items[0][quantity]": "1",
    "subscription_data[metadata][account_id]": ctx.accountId,
    "subscription_data[metadata][plan_code]": plan.code,
    success_url: `${origin}/billing/success`,
    cancel_url: `${origin}/pricing`,
    allow_promotion_codes: "true",
  });

  await audit(db, {
    actorType: "user",
    actorId: ctx.accountId,
    action: "billing.checkout",
    targetType: "plan",
    targetId: plan.code,
  });

  return { url: session.url as string };
}

export async function createPortalSession(
  db: Db,
  ctx: AccountContext,
  origin: string,
): Promise<{ url: string }> {
  const customer = await ensureCustomer(db, ctx);
  const session = await stripeRequest("/billing_portal/sessions", {
    customer,
    return_url: `${origin}/pricing`,
  });
  return { url: session.url as string };
}

/* -------------------------------- webhook -------------------------------- */

export async function verifyStripeSignature(rawBody: string, header: string | null): Promise<boolean> {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!secret || !header) return false;

  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key?.trim() ?? "", rest.join("=")];
    }),
  ) as Record<string, string>;

  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  // Reject replays older than five minutes.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return safeEqual(expected, signature);
}

async function accountForCustomer(db: Db, customerId: string): Promise<string | null> {
  const { data } = await db.from("accounts").select("id").eq("stripe_customer_id", customerId).maybeSingle();
  return (data as any)?.id ?? null;
}

async function upsertSubscription(
  db: Db,
  accountId: string,
  planCode: string,
  fields: {
    status: string;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  },
) {
  const plan = await getPlanByCode(db, planCode);
  const grace = await graceSettings(db);

  const isPaid = ["trialing", "active", "past_due"].includes(fields.status);
  const graceUntil = isPaid
    ? null
    : new Date(Date.now() + (grace.grace_days ?? 14) * 24 * 3600 * 1000).toISOString();

  await db.from("subscriptions").upsert(
    {
      account_id: accountId,
      plan_id: plan.id,
      status: fields.status,
      stripe_subscription_id: fields.stripeSubscriptionId,
      current_period_end: fields.currentPeriodEnd,
      cancel_at_period_end: fields.cancelAtPeriodEnd,
      grace_until: graceUntil,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id" },
  );
}

/** Idempotent webhook processing. Retries never create duplicate subscriptions. */
export async function processStripeEvent(db: Db, event: any): Promise<{ handled: boolean; duplicate: boolean }> {
  const { error: insertError } = await db.from("webhook_events").insert({
    provider: "stripe",
    external_id: String(event.id),
    type: String(event.type),
    payload: {},
  });
  if (insertError) return { handled: false, duplicate: true };

  const object = event.data?.object ?? {};
  let handled = false;

  const resolveAccount = async (): Promise<string | null> =>
    object.metadata?.account_id ??
    object.client_reference_id ??
    (object.customer ? await accountForCustomer(db, String(object.customer)) : null);

  const planCodeFromSub = async (subscription: any): Promise<string> => {
    if (subscription?.metadata?.plan_code) return String(subscription.metadata.plan_code);
    const priceId = subscription?.items?.data?.[0]?.price?.id;
    if (priceId) {
      const { data } = await db.from("plans").select("code").eq("stripe_price_id", priceId).maybeSingle();
      if (data) return (data as any).code;
    }
    return "free";
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const accountId = await resolveAccount();
      if (accountId && object.subscription) {
        const subscription = await stripeRequest(`/subscriptions/${object.subscription}`);
        await upsertSubscription(db, accountId, await planCodeFromSub(subscription), {
          status: subscription.status,
          stripeSubscriptionId: subscription.id,
          currentPeriodEnd: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : null,
          cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        });
        handled = true;
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const accountId = await resolveAccount();
      if (accountId) {
        await upsertSubscription(db, accountId, await planCodeFromSub(object), {
          status: object.status,
          stripeSubscriptionId: object.id,
          currentPeriodEnd: object.current_period_end
            ? new Date(object.current_period_end * 1000).toISOString()
            : null,
          cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
        });
        handled = true;
      }
      break;
    }
    case "customer.subscription.deleted": {
      const accountId = await resolveAccount();
      if (accountId) {
        // Paid rooms survive; management becomes read-only during the grace period.
        await upsertSubscription(db, accountId, await planCodeFromSub(object), {
          status: "canceled",
          stripeSubscriptionId: object.id,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        });
        handled = true;
      }
      break;
    }
    case "invoice.payment_failed": {
      const accountId = await resolveAccount();
      if (accountId) {
        await db
          .from("subscriptions")
          .update({ status: "past_due", updated_at: new Date().toISOString() })
          .eq("account_id", accountId);
        handled = true;
      }
      break;
    }
    default:
      handled = false;
  }

  await db
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("provider", "stripe")
    .eq("external_id", String(event.id));

  await audit(db, { action: `stripe.${event.type}`, targetType: "webhook", targetId: String(event.id) });

  return { handled, duplicate: false };
}
