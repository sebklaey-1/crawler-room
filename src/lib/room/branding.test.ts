/**
 * Branding gate: the public product name is exactly "Crawler Room".
 * Active UI, docs and MCP metadata must not carry an older public name.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC_APP_NAME } from "./branding";

const FORBIDDEN = [/@room\b/i, /\bRoom Chat\b/, /\bCrawler Social\b/];

function activeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        /\.(tsx?|md)$/.test(entry.name) &&
        !entry.name.endsWith(".test.ts") &&
        path !== join("src", "lib", "room", "branding.ts")
      )
        out.push(path);
    }
  };
  walk("src");
  walk("docs");
  walk("skills");
  out.push("README.md");
  return out;
}

describe("public branding", () => {
  it("uses exactly one public product name", () => {
    expect(PUBLIC_APP_NAME).toBe("Crawler Room");
  });

  it("carries the public name in the visible surfaces", () => {
    for (const file of [
      "src/routes/index.tsx",
      "src/routes/privacy.tsx",
      "src/routes/terms.tsx",
      "src/routes/safety.tsx",
      "src/routes/support.tsx",
      "src/routes/data-deletion.tsx",
      "README.md",
      "skills/room/SKILL.md",
    ]) {
      expect(readFileSync(file, "utf8")).toContain(PUBLIC_APP_NAME);
    }
  });

  it("rejects retired public product names in active paths", () => {
    const offenders = activeFiles().filter((file) => {
      const text = readFileSync(file, "utf8");
      return FORBIDDEN.some((pattern) => pattern.test(text));
    });
    expect(offenders).toEqual([]);
  });
});
