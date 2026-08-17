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
] as const) {
  item(
    step[0],
    envSet(step[1]),
    envSet(step[1]) ? "confirmed" : `manual — confirm and set ${step[1]}`,
  );
}

/**
 * Crawler Room is accountless: the consent page signs the visitor in with
 * `signInAnonymously()`. Anonymous sign-ins are therefore REQUIRED in
 * production — a disabled configuration breaks every connect attempt and is a
 * hard release blocker, never an optional policy decision.
 */
async function anonymousSignInEnabled(): Promise<{ ok: boolean; detail: string }> {
  const url = (process.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"])?.trim();
  const key = (
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"]
  )?.trim();
  if (!url || !key) {
    return {
      ok: envSet("ROOM_SUBMIT_ANON_SIGNIN_READY"),
      detail: envSet("ROOM_SUBMIT_ANON_SIGNIN_READY")
        ? "confirmed manually — auth API not reachable from here"
        : "cannot verify — publishable credentials not available here (required, not optional)",
    };
  }
  try {
    const response = await fetch(`${url}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json" },
      body: "{}",
    });
    const body = (await response.json()) as {
      access_token?: string;
      error_code?: string;
      msg?: string;
    };
    // Never print a token value — only whether a session came back.
    if (response.status === 200 && body.access_token) {
      return { ok: true, detail: "anonymous sign-in enabled — accountless connect works" };
    }
    return {
      ok: false,
      detail: `BLOCKER — anonymous sign-in rejected (${response.status} ${body.error_code ?? body.msg ?? "unknown"}); enable it in Auth settings`,
    };
  } catch (error) {
    return { ok: false, detail: `cannot verify — ${(error as Error).message}` };
  }
}

const anon = await anonymousSignInEnabled();
item("anonymous sign-ins enabled (REQUIRED for accountless connect)", anon.ok, anon.detail);



/* ------------------------------- 3. cleanup cron ----------------------------- */

/**
 * The retention cleanup is scheduled inside the database (pg_cron + pg_net).
 * It only stays a manual item while the database cannot confirm exactly one
 * active job together with the vault secret and its server-side hash.
 */
async function cleanupSchedulerReady(): Promise<{ ok: boolean; detail: string }> {
  const url = process.env["SUPABASE_URL"]?.trim();
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!url || !key) {
    return {
      ok: envSet("ROOM_SUBMIT_CLEANUP_CRON_READY"),
      detail: envSet("ROOM_SUBMIT_CLEANUP_CRON_READY")
        ? "confirmed manually — database not reachable from here"
        : "cannot verify — service credentials not available here",
    };
  }
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await db.rpc("cleanup_scheduler_status");
    if (error) return { ok: false, detail: `cannot verify — ${error.message}` };
    // Booleans and counts only — never a secret value.
    const status = (data ?? {}) as Record<string, unknown>;
    const ok =
      status["pg_cron"] === true &&
      status["pg_net"] === true &&
      status["vault_secret_present"] === true &&
      status["token_hash_present"] === true &&
      status["active_jobs"] === 1;
    return {
      ok,
      detail: ok
        ? "database confirms exactly one active cleanup job with a vault-backed token"
        : `database reports ${JSON.stringify(status["active_jobs"] ?? 0)} active job(s); extensions/secret incomplete`,
    };
  } catch (error) {
    return { ok: false, detail: `cannot verify — ${(error as Error).message}` };
  }
}

const cleanup = await cleanupSchedulerReady();
item("retention cleanup scheduled every 15 minutes in the database", cleanup.ok, cleanup.detail);

/* --------------------------- 4. live domain verification --------------------- */

async function liveResourceReachable(): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(
      `${PRODUCTION_ORIGIN}/.well-known/oauth-protected-resource/api/public/mcp`,
      {
        redirect: "follow",
      },
    );
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
  item(
    step[0],
    envSet(step[1]),
    envSet(step[1]) ? "confirmed" : `manual — confirm and set ${step[1]}`,
  );
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
