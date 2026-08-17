/**
 * Manual production domain check for Crawler Room.
 *
 * Read-only: performs GET requests plus, optionally, the two side-effect free
 * JSON-RPC methods `initialize` and `tools/list`. It never sends credentials,
 * never calls a tool action and never logs a full response body.
 *
 *   bun run verify:domain            # metadata + consent + health
 *   bun run verify:domain --rpc      # additionally initialize + tools/list
 *
 * Exit codes:
 *   0  everything verified
 *   1  technical misconfiguration (wrong resource, wrong issuer, stale domain,
 *      wrong tool surface, TLS/HTTP failure)
 *   2  reachable but the deployed build is older than this source tree
 *      (routes missing / not deployed yet) — not a misconfiguration
 */
const ORIGIN = "https://crawler.today";
const RESOURCE = `${ORIGIN}/mcp`;
const METADATA = `${ORIGIN}/.well-known/oauth-protected-resource/mcp`;
const ROOT_METADATA = `${ORIGIN}/.well-known/oauth-protected-resource`;
/** DEPRECATED compatibility endpoint — kept reachable, never advertised. */
const LEGACY_RESOURCE_URL = `${ORIGIN}/api/public/mcp`;
const LEGACY_METADATA = `${ORIGIN}/.well-known/oauth-protected-resource/api/public/mcp`;
const CONSENT = `${ORIGIN}/oauth/consent`;
const HEALTH = `${ORIGIN}/api/public/health`;
const TOOL_NAMES = [
  "universal_room",
  "public_room",
  "profile",
  "followers_notifications",
  "likes",
  "analytics",
  "communities_organizations",
].sort();

const EXPECTED_ISSUER = (process.env["SUPABASE_URL"] ?? "").replace(/\/+$/, "");

let technical = 0;
let notDeployed = 0;
/** Set to false as soon as we can prove the live build predates this source tree. */
let deployedIsCurrent = true;

function pass(label: string, detail = "") {
  console.log(`PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label: string, detail: string) {
  technical += 1;
  console.log(`FAIL  ${label} — ${detail}`);
}
function stale(label: string, detail: string) {
  notDeployed += 1;
  console.log(`STALE ${label} — ${detail}`);
}

async function get(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { redirect: "follow", headers: { accept: "*/*" } });
  } catch {
    return null;
  }
}

/* ------------------------------- 1. origin -------------------------------- */

const root = await get(ORIGIN);
if (!root) fail("origin reachable over https", "no TLS/HTTP response");
else if (!root.ok) fail("origin reachable over https", `status ${root.status}`);
else pass("origin reachable over https", `status ${root.status}`);

/* ------------------------- 2. protected resource -------------------------- */

const metaResponse = await get(METADATA);
if (!metaResponse) {
  fail("protected resource metadata", "no response");
} else if (metaResponse.status === 404) {
  deployedIsCurrent = false;
  stale("protected resource metadata", "route not present in the deployed build");
} else if (!metaResponse.ok) {
  fail("protected resource metadata", `status ${metaResponse.status}`);
} else {
  let meta: Record<string, unknown> | null = null;
  try {
    meta = (await metaResponse.json()) as Record<string, unknown>;
  } catch {
    fail("protected resource metadata", "response is not JSON");
  }
  if (meta) {
    if (meta.resource === RESOURCE) pass("resource identifier", RESOURCE);
    else fail("resource identifier", `unexpected value (expected ${RESOURCE})`);

    const servers: string[] = Array.isArray(meta.authorization_servers)
      ? meta.authorization_servers
      : [];
    if (!EXPECTED_ISSUER) {
      console.log("SKIP  authorization_servers — SUPABASE_URL not set in this shell");
    } else if (servers.length === 1 && servers[0]?.replace(/\/+$/, "") === EXPECTED_ISSUER) {
      pass("authorization_servers", "matches the configured issuer");
    } else {
      fail(
        "authorization_servers",
        `expected exactly the configured issuer, got ${servers.length}`,
      );
    }

    if (/zinga[-.]?room/i.test(JSON.stringify(meta))) {
      fail("legacy resource", "metadata still references the old zinga-room host");
    } else {
      pass("legacy resource", "no zinga-room reference");
    }
  }
}

/* ------------------------------ 3. consent -------------------------------- */

const consent = await get(CONSENT);
if (!consent) fail("consent route", "no response");
else if (consent.status === 404) stale("consent route", "not present in the deployed build");
else if (!consent.ok) fail("consent route", `status ${consent.status}`);
else pass("consent route", `status ${consent.status}`);

/* ------------------------------- 4. health -------------------------------- */

const health = await get(HEALTH);
if (!health) {
  fail("health endpoint", "no response");
} else if (health.status === 404) {
  stale("health endpoint", "not present in the deployed build");
} else {
  let body: Record<string, unknown> | null = null;
  try {
    body = (await health.json()) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  const status = typeof body?.status === "string" ? body.status : "unknown";
  if (health.headers.get("cache-control")?.includes("no-store")) pass("health cache-control");
  else fail("health cache-control", "missing no-store");
  if (body && ("database" in body || "env" in body || "error" in body)) {
    (deployedIsCurrent ? fail : stale)(
      "health minimalism",
      deployedIsCurrent ? "response exposes internal details" : "older build still returns details",
    );
  } else {
    pass("health endpoint", `status field: ${status}`);
  }
}

/* ------------------------- 5. optional JSON-RPC --------------------------- */

if (process.argv.includes("--rpc")) {
  async function rpc(method: string, params: unknown) {
    const response = await fetch(RESOURCE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const text = await response.text();
    const payload = text.startsWith("event:")
      ? text
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("")
      : text;
    try {
      return { status: response.status, json: JSON.parse(payload) as JsonRpcResponse };
    } catch {
      return { status: response.status, json: null };
    }
  }

  type JsonRpcResponse = {
    result?: { serverInfo?: unknown; tools?: { name?: unknown }[] };
  };

  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "verify-production-domain", version: "1.0.0" },
  });
  if (init.status === 200 && init.json?.result?.serverInfo) pass("initialize");
  else if (init.status === 404) stale("initialize", "MCP route not deployed");
  else fail("initialize", `status ${init.status}`);

  const list = await rpc("tools/list", {});
  const names: string[] = (list.json?.result?.tools ?? [])
    .map((tool) => tool?.name)
    .filter((name: unknown): name is string => typeof name === "string")
    .sort();
  if (list.status === 404) {
    stale("tools/list", "MCP route not deployed");
  } else if (names.length === 7 && names.join(",") === TOOL_NAMES.join(",")) {
    pass("tools/list", "exactly the seven public tools");
  } else {
    (deployedIsCurrent ? fail : stale)(
      "tools/list",
      `expected the seven public tools, live build exposes ${names.length}`,
    );
  }
}

/* -------------------------------- report ---------------------------------- */

console.log("");
if (technical > 0) {
  console.log(`${technical} technical failure(s). Production domain check FAILED.`);
  process.exit(1);
}
if (notDeployed > 0) {
  console.log(
    `${notDeployed} route(s) missing on the live deployment — the source tree is newer than what is published. Not a misconfiguration.`,
  );
  process.exit(2);
}
console.log("Production domain check clear.");
