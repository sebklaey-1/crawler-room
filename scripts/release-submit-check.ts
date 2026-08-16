/**
 * Submission gate for Crawler Room — the *manual and external* half of the
 * release checklist. Everything verifiable from the repository lives in
 * `bun run release:check`; this script only reports real-world steps that a
 * human or an external service has to confirm.
 *
 * Exit code 0 = nothing external is outstanding, 1 = at least one open item.
 * No secret value is ever printed — only "set" or "missing".
 *
 *   bun run release:check:submit
 */
import { MODERATION_OWNER } from "../src/lib/room/legal";
import { PRODUCTION_MCP_RESOURCE, PRODUCTION_ORIGIN } from "../src/lib/room/auth";

interface Item {
  name: string;
  ok: boolean;
  detail: string;
}

const items: Item[] = [];

function item(name: string, ok: boolean, detail: string) {
  items.push({ name, ok, detail });
}

function envSet(name: string): boolean {
  const value = process.env[name];
  return Boolean(value && value.trim());
}

/* ------------------------- 1. live moderator on record ----------------------- */

async function moderatorConfigured(): Promise<{ ok: boolean; detail: string }> {
  const url = process.env["SUPABASE_URL"]?.trim();
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!url || !key) {
    return { ok: false, detail: "cannot verify — service credentials not available here" };
  }
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { count, error } = await db
      .from("moderator_subjects")
      .select("id", { count: "exact", head: true })
      .eq("active", true);
    if (error) return { ok: false, detail: `cannot verify — ${error.message}` };
    // Never print a subject hash: the number of active moderators is enough.
    return {
      ok: (count ?? 0) > 0,
      detail:
        (count ?? 0) > 0
          ? `${count} active moderator subject(s) on record`
          : "missing — add the real moderator subject hash to moderator_subjects (never in code)",
    };
  } catch (error) {
    return { ok: false, detail: `cannot verify — ${(error as Error).message}` };
  }
}

const moderator = await moderatorConfigured();
item(`moderator on record for ${MODERATION_OWNER}`, moderator.ok, moderator.detail);

/* ---------------------- 2. Supabase auth server configuration ---------------- */

for (const step of [
  ["OAuth 2.1 authorization server enabled", "ROOM_SUBMIT_OAUTH_SERVER_READY"],
  ["dynamic client registration / redirect URIs registered", "ROOM_SUBMIT_OAUTH_REDIRECTS_READY"],
  ["custom access token hook enabled", "ROOM_SUBMIT_TOKEN_HOOK_READY"],
  ["anonymous sign-in policy reviewed", "ROOM_SUBMIT_ANON_POLICY_READY"],
] as const) {
  item(step[0], envSet(step[1]), envSet(step[1]) ? "confirmed" : `manual — confirm and set ${step[1]}`);
}

/* ------------------------------- 3. cleanup cron ----------------------------- */

item(
  "retention cleanup scheduled (cleanup_expired / cleanup_support_requests)",
  envSet("ROOM_SUBMIT_CLEANUP_CRON_READY"),
  envSet("ROOM_SUBMIT_CLEANUP_CRON_READY")
    ? "confirmed"
    : "manual — schedule the cleanup job and set ROOM_SUBMIT_CLEANUP_CRON_READY",
);

/* --------------------------- 4. live domain verification --------------------- */

async function liveResourceReachable(): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(`${PRODUCTION_ORIGIN}/.well-known/oauth-protected-resource`, {
      redirect: "follow",
    });
    if (!response.ok) return { ok: false, detail: `metadata endpoint returned ${response.status}` };
    const body = (await response.json()) as { resource?: string };
    return {
      ok: body.resource === PRODUCTION_MCP_RESOURCE,
      detail:
        body.resource === PRODUCTION_MCP_RESOURCE
          ? `live metadata advertises ${PRODUCTION_MCP_RESOURCE}`
          : `live metadata advertises «${body.resource ?? "nothing"}»`,
    };
  } catch (error) {
    return { ok: false, detail: `not reachable from here — ${(error as Error).message}` };
  }
}

const live = await liveResourceReachable();
item(`live domain serves ${PRODUCTION_MCP_RESOURCE}`, live.ok, live.detail);

/* --------------------- 5. portal metadata and reviewer assets ---------------- */

for (const step of [
  ["OpenAI portal metadata submitted (name «Crawler Room»)", "ROOM_SUBMIT_PORTAL_METADATA_READY"],
  ["reviewer test account / walkthrough handed over", "ROOM_SUBMIT_REVIEWER_ASSETS_READY"],
] as const) {
  item(step[0], envSet(step[1]), envSet(step[1]) ? "confirmed" : `manual — confirm and set ${step[1]}`);
}

/* ---------------------------------- report ----------------------------------- */

let open = 0;
for (const entry of items) {
  if (!entry.ok) open += 1;
  console.log(`${(entry.ok ? "DONE" : "OPEN").padEnd(5)} ${entry.name} — ${entry.detail}`);
}

console.log(`\n${items.length - open}/${items.length} external items confirmed.`);
if (open > 0) {
  console.log("Submission blocked by external/manual steps only. See docs/release-checklist.md.");
  process.exit(1);
}
console.log("Submission gate clear.");
