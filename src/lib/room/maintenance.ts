/**
 * Internal maintenance plumbing: cleanup authentication and run metrics.
 *
 * The scheduler (pg_cron + pg_net) authenticates with a token that only ever
 * exists in Supabase Vault. The server verifies it against the SHA-256 digest
 * stored in `internal_secret_hashes`; no token value is logged, returned or
 * persisted in clear text. `ADMIN_TOKEN` stays supported as a manual fallback.
 */
import { safeEqual, sha256Hex } from "./crypto";
import type { Db } from "./store";

export const CLEANUP_TOKEN_NAME = "crawler_room_cleanup_token";

/** Extracts the presented token from either accepted header. */
export function presentedCleanupToken(request: Request): string {
  const header =
    request.headers.get("x-admin-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  return header.trim();
}

/** Constant-time comparison against the configured `ADMIN_TOKEN`, if any. */
export function matchesAdminToken(provided: string): boolean {
  const expected = (process.env["ADMIN_TOKEN"] ?? "").trim();
  if (!expected || !provided) return false;
  return safeEqual(expected, provided);
}

/**
 * Constant-time comparison against the vault-generated cleanup token.
 * Fail-closed: any read error or missing hash row rejects the request.
 */
export async function matchesDatabaseToken(db: Db, provided: string): Promise<boolean> {
  if (!provided) return false;
  try {
    const { data, error } = await db
      .from("internal_secret_hashes")
      .select("sha256")
      .eq("name", CLEANUP_TOKEN_NAME)
      .maybeSingle();
    const expected = (data as { sha256?: string } | null)?.sha256 ?? "";
    if (error || !expected) return false;
    return safeEqual(expected, await sha256Hex(new TextEncoder().encode(provided)));
  } catch {
    return false;
  }
}

/** True when the caller may run the cleanup job. Never logs token material. */
export async function authorizeCleanup(db: Db | null, request: Request): Promise<boolean> {
  const provided = presentedCleanupToken(request);
  if (!provided) return false;
  if (matchesAdminToken(provided)) return true;
  if (!db) return false;
  return matchesDatabaseToken(db, provided);
}

/* ------------------------------ run metrics ------------------------------- */

export async function startMaintenanceRun(db: Db): Promise<number | null> {
  const { data, error } = await db
    .from("maintenance_runs")
    .insert({ status: "running" })
    .select("id")
    .maybeSingle();
  if (error) return null;
  return (data as { id?: number } | null)?.id ?? null;
}

export async function finishMaintenanceRun(
  db: Db,
  id: number | null,
  status: "ok" | "failed",
  counters: Record<string, number>,
  errorCategory?: string,
): Promise<void> {
  if (id === null) return;
  await db
    .from("maintenance_runs")
    .update({
      finished_at: new Date().toISOString(),
      status,
      counters,
      error_category: errorCategory ? errorCategory.slice(0, 64) : null,
    })
    .eq("id", id);
}
