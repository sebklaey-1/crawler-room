/**
 * Plan catalogue and platform settings.
 * Everything (names, prices, limits, entitlements) lives in the database so
 * plans can be changed without a code deploy.
 */
import { roomError } from "./errors";
import type { Db } from "./store";

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  tagline: string | null;
  price_cents: number;
  currency: string;
  interval: string;
  sort_order: number;
  active: boolean;
  stripe_price_id: string | null;
  limits: Record<string, number>;
  entitlements: Record<string, boolean>;
}

export async function listPlans(db: Db): Promise<PlanRow[]> {
  const { data, error } = await db
    .from("plans")
    .select(
      "id, code, name, tagline, price_cents, currency, interval, sort_order, active, stripe_price_id, limits, entitlements",
    )
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw roomError("INTERNAL_ERROR");
  return (data ?? []) as unknown as PlanRow[];
}

export async function getPlanByCode(db: Db, code: string): Promise<PlanRow> {
  const { data, error } = await db
    .from("plans")
    .select(
      "id, code, name, tagline, price_cents, currency, interval, sort_order, active, stripe_price_id, limits, entitlements",
    )
    .eq("code", code)
    .maybeSingle();
  if (error || !data) throw roomError("INTERNAL_ERROR");
  return data as unknown as PlanRow;
}

export async function getPlanById(db: Db, id: string): Promise<PlanRow | null> {
  const { data } = await db
    .from("plans")
    .select(
      "id, code, name, tagline, price_cents, currency, interval, sort_order, active, stripe_price_id, limits, entitlements",
    )
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as PlanRow) ?? null;
}

/* --------------------------- platform settings --------------------------- */

export interface UniversalSettings {
  retention_hours: number;
  page_size: number;
  max_page_size: number;
  rate_per_minute: number;
  rate_per_hour: number;
  image_retention: number;
}

export interface AdSettings {
  frequency_cap_per_hour: number;
  max_placements_per_page: number;
  min_aggregation_threshold: number;
  default_cost_per_entry_cents: number;
}

const UNIVERSAL_DEFAULTS: UniversalSettings = {
  retention_hours: 6,
  page_size: 50,
  max_page_size: 100,
  rate_per_minute: 6,
  rate_per_hour: 60,
  image_retention: 20,
};

const AD_DEFAULTS: AdSettings = {
  frequency_cap_per_hour: 2,
  max_placements_per_page: 2,
  min_aggregation_threshold: 25,
  default_cost_per_entry_cents: 50,
};

export async function getSetting<T extends object>(db: Db, key: string, fallback: T): Promise<T> {
  const { data } = await db.from("platform_settings").select("value").eq("key", key).maybeSingle();
  const value = data?.value;
  return value && typeof value === "object" ? { ...fallback, ...value } : fallback;
}

export const universalSettings = (db: Db) => getSetting(db, "universal_room", UNIVERSAL_DEFAULTS);
export const adSettings = (db: Db) => getSetting(db, "advertising", AD_DEFAULTS);
export const graceSettings = (db: Db) => getSetting(db, "grace", { grace_days: 14 });
