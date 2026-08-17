import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { LEGAL_LINKS } from "./legal";
import { SURFACE_TOOLS } from "./mcp.surface";

const SUBMISSION = readFileSync("docs/openai-plugin-submission.md", "utf8");
const INVENTORY = readFileSync("docs/privacy-data-inventory.md", "utf8");
const README = readFileSync("README.md", "utf8");
const SKILL = readFileSync("skills/room/SKILL.md", "utf8");

const REAL_TOOLS = [
  "universal_room",
  "public_room",
  "profile",
  "followers_notifications",
  "likes",
  "analytics",
  "communities_organizations",
];

const ALIAS_TOOLS = ["my_room", "social", "notifications", "communities"];

const ACTIVE_DOC_FILES = [
  "docs/openai-plugin-submission.md",
  "docs/privacy-data-inventory.md",
  "docs/oauth-supabase-setup.md",
  "README.md",
  "skills/room/SKILL.md",
  "src/routes/index.tsx",
  "src/routes/privacy.tsx",
  "src/routes/terms.tsx",
  "src/routes/safety.tsx",
  "src/routes/support.tsx",
  "src/routes/data-deletion.tsx",
  "src/components/oauth-consent.tsx",
  "src/components/legal-footer.tsx",
];

describe("submission dossier", () => {
  it("names exactly the seven real tools", () => {
    for (const tool of REAL_TOOLS) {
      expect(SUBMISSION, `${tool} missing`).toContain(`\`${tool}\``);
    }
    expect(SURFACE_TOOLS.map((tool) => tool.name).sort()).toEqual([...REAL_TOOLS].sort());
  });

  it("uses no alias tool names anywhere in the dossier", () => {
    for (const alias of ALIAS_TOOLS) {
      // `communities` / `notifications` only ever appear as part of a real name.
      const stray = new RegExp(`\`${alias}\``);
      expect(stray.test(SUBMISSION), `alias ${alias} present`).toBe(false);
    }
  });

  it("lists the real action enums per tool", () => {
    for (const tool of SURFACE_TOOLS) {
      const schema = tool.inputSchema as {
        properties?: { action?: { enum?: string[] } };
      };
      const actions = schema.properties?.action?.enum ?? [];
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(SUBMISSION, `${tool.name}.${action} undocumented`).toContain(action);
      }
    }
  });

  it("documents annotations and their rationale", () => {
    for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint", "idempotentHint"]) {
      expect(SUBMISSION).toContain(hint);
    }
  });

  it("pins the canonical resource and claims no OpenAI relationship", () => {
    expect(SUBMISSION).toContain("https://crawler.today/mcp");
    expect(SUBMISSION).toContain("https://crawler.today/.well-known/oauth-protected-resource/mcp");
    expect(SUBMISSION).toMatch(/not affiliated with/i);
    expect(SUBMISSION).toMatch(/App Directory/);
    expect(SUBMISSION).not.toMatch(/partner(ship)? with OpenAI/i);
  });

  it("ships exactly three starter prompts", () => {
    const section = SUBMISSION.split("## Starter prompts")[1]?.split("\n## ")[0] ?? "";
    const prompts = section.match(/^\d\. `Crawler Room/gm) ?? [];
    expect(prompts).toHaveLength(3);
  });

  it("ships at least five positive and three negative reviewer test cases", () => {
    const positive = SUBMISSION.split("### Positive")[1]?.split("### Negative")[0] ?? "";
    const negative = SUBMISSION.split("### Negative")[1]?.split("\n## ")[0] ?? "";
    const rows = (block: string, prefix: string) =>
      (block.match(new RegExp(`^\\|\\s*${prefix}\\d+\\s*\\|`, "gm")) ?? []).length;
    expect(rows(positive, "P")).toBeGreaterThanOrEqual(5);
    expect(rows(negative, "N")).toBeGreaterThanOrEqual(3);
    for (const block of [positive, negative]) {
      expect(block).toMatch(/OAuth|none/);
    }
  });

  it("describes a reviewer account without MFA or private network", () => {
    expect(SUBMISSION).toMatch(/no MFA/i);
    expect(SUBMISSION).toMatch(/review portal/i);
  });

  it("ships no reviewer credentials and no invented contact details", () => {
    // Credentials must never live in the repository, and the only support
    // channel we may name is the implemented /support form.
    expect(SUBMISSION).not.toMatch(/password\s*[:=]/i);
    expect(SUBMISSION).not.toMatch(/[\w.+-]+@(?!room)[\w-]+\.[a-z]{2,}/i);
    expect(SUBMISSION).not.toMatch(/\+\d[\d\s()-]{7,}/);
    expect(SUBMISSION).toContain("https://crawler.today/support");
  });

  it("uses only crawler.today URLs", () => {
    const urls = SUBMISSION.match(/https?:\/\/[^\s`)|]+/g) ?? [];
    const foreign = urls.filter(
      (url) => !url.startsWith("https://crawler.today") && !url.includes("openai.com"),
    );
    expect(foreign, `unexpected URLs: ${foreign.join(", ")}`).toEqual([]);
  });

  it("describes support and deletion as manual queues", () => {
    expect(SUBMISSION).toMatch(/no monitored mailbox|There is no\s+monitored mailbox/i);
    expect(SUBMISSION).toMatch(/service-role/i);
  });
});

describe("repository-wide documentation audit", () => {
  it("never references the old zinga domain in active docs or UI", () => {
    for (const file of ACTIVE_DOC_FILES) {
      expect(readFileSync(file, "utf8"), `${file} references zinga`).not.toContain(
        "zinga-room.lovable.app",
      );
    }
  });

  it("keeps the canonical resource in README, skill and inventory", () => {
    for (const source of [README, SKILL, INVENTORY]) {
      expect(source).toContain("crawler.today");
      expect(source).not.toContain("zinga-room.lovable.app");
    }
  });

  it("does not advertise a report MCP action", () => {
    for (const source of [SUBMISSION, README, SKILL]) {
      expect(source).not.toMatch(/`report_message`/);
    }
  });

  it("does not claim login-free writing", () => {
    expect(README).not.toMatch(/without a separate login/i);
    expect(readFileSync("src/routes/index.tsx", "utf8")).not.toMatch(/no sign-up, no login/i);
  });

  it("phrases time-based retention as a target, not a guarantee", () => {
    expect(readFileSync("src/routes/privacy.tsx", "utf8")).toMatch(/maintenance job/i);
    expect(SUBMISSION).toMatch(/maintenance job/i);
  });

  it("keeps every mandatory legal link present in the footer set", () => {
    expect(LEGAL_LINKS).toHaveLength(5);
    const footer = readFileSync("src/components/legal-footer.tsx", "utf8");
    expect(footer).toContain("LEGAL_LINKS");
  });
});
