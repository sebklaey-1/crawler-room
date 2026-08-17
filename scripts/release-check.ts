/**
 * Deterministic release gate for Crawler Room.
 *
 * Verifies everything that can be verified from the repository plus the
 * presence (never the value) of the required runtime configuration. No secret
 * is printed — only "set" or "missing".
 *
 * Exit code 0 = releasable, 1 = at least one blocker.
 *
 *   bun run release:check
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  MODERATION_OWNER,
  moderationOwnerEnvMatches,
  supportEmailEnvMatches,
} from "../src/lib/room/legal";

const ROOT = process.cwd();
const CANONICAL_RESOURCE = "https://crawler.today/api/public/mcp";
const TOOL_NAMES = [
  "universal_room",
  "public_room",
  "profile",
  "followers_notifications",
  "likes",
  "analytics",
  "communities_organizations",
];

interface Result {
  name: string;
  ok: boolean;
  blocker: boolean;
  detail: string;
}

const results: Result[] = [];

function check(name: string, ok: boolean, detail: string, blocker = true) {
  results.push({ name, ok, blocker, detail });
}

function read(path: string): string {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

/* --------------------------- 1. canonical resource --------------------------- */

const auth = read("src/lib/room/auth.ts");
const pinned =
  auth.includes(CANONICAL_RESOURCE) ||
  (auth.includes('PRODUCTION_ORIGIN = "https://crawler.today"') &&
    auth.includes("/api/public/mcp"));
check("canonical resource pinned", pinned, `auth.ts pins ${CANONICAL_RESOURCE}`);

/* ------------------------------ 2. tool surface ------------------------------ */

const surface = read("src/lib/room/mcp.surface.ts");
const declared = [...surface.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map((match) => match[1]);
check(
  "exactly seven public tools",
  declared.length === 7 && TOOL_NAMES.every((tool) => declared.includes(tool)),
  `found ${declared.length}: ${declared.join(", ")}`,
);
check(
  "every tool has annotations",
  TOOL_NAMES.every((tool) => surface.includes(`TOOL_ANNOTATIONS["${tool}"]`)),
  "annotations are wired per tool",
);
check(
  "runtime output contract enforced",
  read("src/lib/room/mcp.ts").includes("enforceOutputContract"),
  "tool results are validated and reduced before they leave the server",
);
check(
  "every tool declares explicit security schemes",
  surface.includes("securitySchemesFor(tool.name)") && surface.includes('{ type: "noauth" }'),
  "noauth is advertised only where public actions exist; oauth2 always",
);

/* ------------------- 2b. annotations, matrix and submission ------------------ */

const matrix = read("src/lib/room/actions.matrix.ts");
check(
  "annotations are derived from the checked-in action matrix",
  matrix.includes("export const ACTION_MATRIX") &&
    surface.includes("annotationsFor(tool)") &&
    !/readOnlyHint: (true|false),\s*\n\s*destructiveHint/.test(surface),
  "no hand-written hints in mcp.surface.ts",
);

const submission = read("docs/openai-submission-ready.json");
let submissionPkg: {
  tools?: Array<{ name: string; annotations: Record<string, boolean>; securitySchemes: unknown[] }>;
  starter_prompts?: string[];
  test_cases?: { positive?: unknown[]; negative?: unknown[] };
} = {};
try {
  submissionPkg = JSON.parse(submission || "{}");
} catch {
  submissionPkg = {};
}
check(
  "submission package parses and lists the seven tools",
  (submissionPkg.tools ?? []).length === 7 &&
    TOOL_NAMES.every((tool) => (submissionPkg.tools ?? []).some((entry) => entry.name === tool)),
  `docs/openai-submission-ready.json — ${(submissionPkg.tools ?? []).length} tools`,
);
check(
  "every documented tool carries all three hints plus a rationale",
  (submissionPkg.tools ?? []).every(
    (tool) =>
      typeof tool.annotations?.["readOnlyHint"] === "boolean" &&
      typeof tool.annotations?.["destructiveHint"] === "boolean" &&
      typeof tool.annotations?.["openWorldHint"] === "boolean" &&
      (tool.securitySchemes ?? []).length > 0,
  ),
  "annotation + security-scheme matrix complete",
);
check(
  "five positive and at least three negative test cases",
  (submissionPkg.test_cases?.positive ?? []).length === 5 &&
    (submissionPkg.test_cases?.negative ?? []).length >= 3,
  `${(submissionPkg.test_cases?.positive ?? []).length} positive / ${(submissionPkg.test_cases?.negative ?? []).length} negative`,
);
check(
  "six to ten realistic starter prompts",
  (submissionPkg.starter_prompts ?? []).length >= 6 &&
    (submissionPkg.starter_prompts ?? []).length <= 10,
  `${(submissionPkg.starter_prompts ?? []).length} prompts`,
);
check(
  "docs/openai-submission-ready.md present",
  existsSync(join(ROOT, "docs/openai-submission-ready.md")),
  "human-readable review package",
);

/* --------------------- 2c. strict OAuth resource binding --------------------- */

check(
  "verifier has no «authenticated» audience fallback",
  !/audiences\.includes\("authenticated"\)/.test(auth),
  "only the canonical resource is accepted as audience",
);
check(
  "verifier enforces the declared oauth2 scopes",
  auth.includes("REQUIRED_SCOPES") && /for \(const required of REQUIRED_SCOPES\)/.test(auth),
  "openid + profile required, fail closed",
);
check(
  "challenge carries resource_metadata, error and error_description",
  auth.includes("`Bearer resource_metadata=") &&
    auth.includes('error_description="') &&
    /challengeHeader\(\s*origin,\s*"invalid_token",/.test(read("src/lib/room/mcp.ts")),
  "reauth challenge is spec complete",
);

/* ------------------------------ 3. legal routes ------------------------------ */

for (const route of ["privacy", "terms", "support", "safety", "data-deletion"]) {
  check(`/${route} page exists`, existsSync(join(ROOT, `src/routes/${route}.tsx`)), "route file");
}

// `resource_documentation` points at https://crawler.today/crawler-room, which
// must be served by THIS project as a real page (200, no redirect).
const docRoute = read("src/routes/crawler-room.tsx");
check(
  "/crawler-room documentation alias exists",
  existsSync(join(ROOT, "src/routes/crawler-room.tsx")) &&
    docRoute.includes('createFileRoute("/crawler-room")') &&
    docRoute.includes("CrawlerRoomLanding") &&
    !/redirect/i.test(docRoute),
  "renders the landing page directly",
);


/* ------------------------------ 4. documentation ----------------------------- */

for (const doc of [
  "docs/openai-review-checklist.md",
  "docs/reviewer-test-plan.md",
  "docs/data-flow.md",
  "docs/threat-model.md",
  "docs/moderation-and-incident-response.md",
  "docs/release-checklist.md",
  "docs/openai-plugin-submission.md",
]) {
  check(`${doc} present`, existsSync(join(ROOT, doc)), "documentation file");
}

/* ---------------------------- 5. forbidden strings --------------------------- */

const activeFiles = [
  "src/lib/room/auth.ts",
  "src/lib/room/mcp.ts",
  "src/lib/room/mcp.surface.ts",
  "src/routes/index.tsx",
  "README.md",
  "docs/openai-plugin-submission.md",
];
const stale = activeFiles.filter((file) => /zinga[-.]?room/i.test(read(file)));
check("no legacy domain in active code/docs", stale.length === 0, stale.join(", ") || "clean");

const landing = read("src/routes/index.tsx");
check(
  "no unsupported claims on the landing page",
  !/Everything can be reported/i.test(landing) && !/no login/i.test(landing),
  "landing page copy matches the OAuth model",
);

/* --------------------------- 6. runtime configuration ------------------------ */

function envSet(name: string): boolean {
  const value = process.env[name];
  return Boolean(value && value.trim());
}

// The canonical resource lives in source (`PRODUCTION_MCP_RESOURCE`). An env
// override is tolerated only when it carries the exact same URL.
const configuredResource = (process.env["ROOM_MCP_RESOURCE"] ?? "").trim();
check(
  "MCP resource canonical",
  configuredResource === "" || configuredResource === CANONICAL_RESOURCE,
  configuredResource === ""
    ? "source of truth in src/lib/room/auth.ts"
    : configuredResource === CANONICAL_RESOURCE
      ? "env matches canonical resource"
      : `env ROOM_MCP_RESOURCE «${configuredResource}» conflicts with ${CANONICAL_RESOURCE}`,
);
for (const secret of ["SUBJECT_HASH_SECRET", "MESSAGE_ID_SECRET"]) {
  check(`${secret} configured`, envSet(secret), envSet(secret) ? "set" : "missing");
}
for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]) {
  check(`${key} configured`, envSet(key), envSet(key) ? "set" : "missing");
}
// The public support contact is canonical in source (`SUPPORT_EMAIL`). An env
// override is tolerated only when it carries the exact same address.
const configuredSupport = (process.env["VITE_PUBLIC_SUPPORT_EMAIL"] ?? "").trim();
check(
  "public support contact canonical (info@crawler.today)",
  supportEmailEnvMatches(configuredSupport),
  configuredSupport === ""
    ? "source of truth in src/lib/room/legal.ts"
    : supportEmailEnvMatches(configuredSupport)
      ? "env matches canonical address"
      : `env VITE_PUBLIC_SUPPORT_EMAIL «${configuredSupport}» conflicts with info@crawler.today`,
);

// The publicly named moderation owner is canonical in source. An env override
// is tolerated only when it repeats the exact same name. The operational
// moderator allowlist (`moderator_subjects`) is verified by release:check:submit.
const configuredOwner = (process.env["ROOM_MODERATION_OWNER"] ?? "").trim();
check(
  `public moderation owner canonical (${MODERATION_OWNER})`,
  moderationOwnerEnvMatches(configuredOwner),
  configuredOwner === ""
    ? "source of truth in src/lib/room/legal.ts"
    : moderationOwnerEnvMatches(configuredOwner)
      ? "env matches canonical owner"
      : `env ROOM_MODERATION_OWNER «${configuredOwner}» conflicts with ${MODERATION_OWNER}`,
);

/* ------------------------------- 7. branding -------------------------------- */

const BRANDED_FILES = [
  "src/routes/index.tsx",
  "src/components/oauth-consent.tsx",
  "README.md",
  "skills/room/SKILL.md",
];
for (const file of BRANDED_FILES) {
  const text = read(file) || "";
  check(`public name «Crawler Room» in ${file}`, text.includes("Crawler Room"), "present");
  check(
    `no retired public name in ${file}`,
    !/@room\b/i.test(text) && !/\bRoom Chat\b/.test(text) && !/\bCrawler Social\b/.test(text),
    "clean",
  );
}

/* --------------------------------- 8. scripts -------------------------------- */

const pkg = JSON.parse(read("package.json") || "{}") as { scripts?: Record<string, string> };
for (const script of [
  "test",
  "test:db",
  "build",
  "typecheck",
  "release:check",
  "release:check:submit",
]) {
  check(`package script «${script}»`, Boolean(pkg.scripts?.[script]), "defined");
}

/* ------------------------------ 9. test isolation ---------------------------- */

const testScript = pkg.scripts?.["test"] ?? "";
const dbScript = pkg.scripts?.["test:db"] ?? "";
check(
  "standard test script carries no database opt-in",
  !/ROOM_RUN_DB_CONTRACT_TESTS|ROOM_TEST_SUPABASE|SUPABASE_SERVICE_ROLE_KEY|db\.config/.test(
    testScript,
  ),
  `«${testScript}»`,
);
check(
  "database contract suite is a separate script",
  dbScript.includes("vitest.db.config.ts"),
  `«${dbScript}»`,
);
check(
  "database contract config excluded from the default run",
  read("vitest.config.ts").includes('include: ["src/**/*.test.ts"]') &&
    read("vitest.db.config.ts").includes('include: ["src/**/*.db.spec.ts"]'),
  "default run matches *.test.ts only",
);

const contract = read("src/lib/room/uniqueness.db.spec.ts");
check(
  "database contract suite requires its own credentials and an explicit acknowledgement",
  contract.includes("ROOM_TEST_SUPABASE_URL") &&
    contract.includes("ROOM_TEST_SUPABASE_SERVICE_ROLE_KEY") &&
    contract.includes("ROOM_RUN_DB_CONTRACT_TESTS") &&
    contract.includes("ROOM_DB_CONTRACT_WRITE_ACK") &&
    !/process\.env\["SUPABASE_SERVICE_ROLE_KEY"\]/.test(contract),
  "fail-closed opt-in, never the connected project credentials",
);

// No standard test may reach the service-role client or the normal service key.
// The file list is derived recursively from the pattern vitest.config.ts uses
// (src/**/*.test.ts); *.db.spec.ts contract suites are excluded by that pattern.
function collectStandardTests(dir: string): string[] {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...collectStandardTests(rel));
    else if (entry.name.endsWith(".test.ts")) found.push(rel);
  }
  return found;
}

const standardTests = collectStandardTests("src").sort();
check(
  "standard test files discovered",
  standardTests.length > 0,
  standardTests.length > 0
    ? `${standardTests.length} files match src/**/*.test.ts`
    : "no standard test file found — fail closed",
);
const leaking = standardTests.filter((file) => {
  // Writing a dummy value inside the fail-closed guard test is allowed;
  // *reading* the real service key, importing the service-role client or
  // constructing a Supabase client directly is not.
  const text = read(file);
  return (
    text.includes("integrations/supabase/client.server") ||
    /process\.env\["SUPABASE_SERVICE_ROLE_KEY"\](?!\s*=[^=])/.test(text) ||
    /\bcreateClient\s*\(/.test(text)
  );
});
check(
  `no standard test uses service-role database access (${standardTests.length} files checked)`,
  leaking.length === 0,
  leaking.join(", ") || "clean",
);

const store = read("src/lib/room/store.ts");
check(
  "test-only database override cannot be activated in production",
  store.includes("__setTestDb") &&
    store.includes('process.env["NODE_ENV"] === "test"') &&
    /if \(!isTestRuntime\(\)\) return;/.test(store) &&
    store.includes("getDb() is disabled in tests"),
  "override is inert outside NODE_ENV=test and getDb() fails closed inside it",
);

/* ------------------- 10. automated retention + storage retries --------------- */

const imagestore = read("src/lib/room/imagestore.ts");
check(
  "storage paths are queued before an image row is deleted",
  imagestore.includes("queueStorageDeletion") &&
    imagestore.indexOf("queueStorageDeletion(db, [row.storage_path])") <
      imagestore.indexOf('.from("image_messages").delete()'),
  "deleteImageRow queues first, deletes second",
);
check(
  "storage removal reports failures instead of only logging them",
  imagestore.includes("complete_storage_deletion") &&
    imagestore.includes("fail_storage_deletion") &&
    imagestore.includes("StorageRemovalResult"),
  "queue entries are completed or retried with a bounded backoff",
);
check(
  "sweep drains the persistent deletion queue in bounded batches",
  imagestore.includes("due_storage_deletions") &&
    /processDeletionQueue\(db, 100\)/.test(imagestore),
  "sweepImages processes up to 100 due paths per run",
);

const cleanupRoute = read("src/routes/api.public.admin.cleanup.ts");
check(
  "cleanup route authenticates through the vault-backed token registry",
  cleanupRoute.includes("authorizeCleanup") &&
    cleanupRoute.includes("startMaintenanceRun") &&
    cleanupRoute.includes("finishMaintenanceRun"),
  "fail-closed auth plus a maintenance run record per invocation",
);

const maintenance = read("src/lib/room/maintenance.ts");
check(
  "no cleanup token material in source",
  maintenance.includes("internal_secret_hashes") &&
    maintenance.includes("safeEqual") &&
    !/crawler_room_cleanup_token\s*=\s*"[^"]{16,}"/.test(maintenance),
  "only the secret name and its SHA-256 comparison live in code",
);

check(
  "path-specific RFC 9728 metadata route present",
  existsSync(join(ROOT, "src/routes/[.]well-known.oauth-protected-resource.api.public.mcp.ts")) &&
    auth.includes("/.well-known/oauth-protected-resource"),
  "challenges point at https://crawler.today/.well-known/oauth-protected-resource/api/public/mcp",
);

/* --------------------------------- report ------------------------------------ */

let failed = 0;
for (const result of results) {
  if (!result.ok) failed += 1;
  const mark = result.ok ? "PASS" : result.blocker ? "BLOCK" : "WARN";
  console.log(`${mark.padEnd(5)} ${result.name} — ${result.detail}`);
}

console.log(`\n${results.length - failed}/${results.length} checks passed.`);
if (failed > 0) {
  console.log("Release blocked. See docs/release-checklist.md for the manual steps.");
  process.exit(1);
}
console.log("Release gate clear.");
