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
import { readFileSync, existsSync } from "node:fs";
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

/* ------------------------------ 3. legal routes ------------------------------ */

for (const route of ["privacy", "terms", "support", "safety", "data-deletion"]) {
  check(`/${route} page exists`, existsSync(join(ROOT, `src/routes/${route}.tsx`)), "route file");
}

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
  const text = read(file);
  return (
    text.includes("integrations/supabase/client.server") ||
    /\bSUPABASE_SERVICE_ROLE_KEY\b/.test(text.replace(/ROOM_TEST_SUPABASE_SERVICE_ROLE_KEY/g, "")) ||
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
