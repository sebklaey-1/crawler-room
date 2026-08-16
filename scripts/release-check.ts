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

check(
  "ROOM_MCP_RESOURCE configured",
  process.env["ROOM_MCP_RESOURCE"]?.trim() === CANONICAL_RESOURCE,
  process.env["ROOM_MCP_RESOURCE"] ? "set" : "missing",
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

// Moderation staffing: a named responsible person plus at least one configured
// moderator subject hash in `moderator_subjects`. Confirmed operationally by
// setting ROOM_MODERATION_OWNER; the allowlist itself is never read from here.
check(
  "moderation staffing confirmed (ROOM_MODERATION_OWNER)",
  envSet("ROOM_MODERATION_OWNER"),
  envSet("ROOM_MODERATION_OWNER")
    ? "named responsible person recorded"
    : "missing — manual release blocker: name a moderator and add their subject hash to moderator_subjects",
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
for (const script of ["test", "build", "typecheck", "release:check"]) {
  check(`package script «${script}»`, Boolean(pkg.scripts?.[script]), "defined");
}

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
