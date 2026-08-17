/**
 * Staleness gate for every review / submission artefact.
 *
 * The canonical contract is `actions.matrix.ts` + the live input schemas. A
 * document that restates actions, annotations or scopes must embed the
 * generated block; otherwise it silently drifts and becomes a review risk.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ACTION_MATRIX } from "./actions.matrix";
import { SURFACE_TOOLS } from "./mcp.surface";
import { allActions, applyGeneratedBlocks, blocksIn, GENERATED_DOCS } from "./review.docs";

/** Actions that were removed from the public surface and must not reappear. */
const RETIRED_ACTIONS = ["set_image", "report_message", "create_organization", "add_member"];
/** Fields that no longer exist in any schema. */
const RETIRED_FIELDS = ["image_data", "upload_url", "avatar_url", "banner_url"];

const REVIEW_DOCS = [
  ...GENERATED_DOCS,
  "docs/openai-submission-ready.json",
  "docs/reviewer-test-plan.md",
];

describe("generated review documentation", () => {
  it("is regenerated for every document that embeds a block", () => {
    for (const doc of GENERATED_DOCS) {
      const current = readFileSync(doc, "utf8");
      expect(blocksIn(current).length, `${doc} has no generated block`).toBeGreaterThan(0);
      expect(applyGeneratedBlocks(current), `${doc} is stale — run bun run docs:review`).toBe(
        current,
      );
    }
  });

  it("covers the annotation and action tables in the review checklist", () => {
    const checklist = readFileSync("docs/openai-review-checklist.md", "utf8");
    expect(blocksIn(checklist)).toEqual(
      expect.arrayContaining(["tool-actions", "tool-annotations"]),
    );
  });
});

describe("review documents match the live surface", () => {
  it("names no retired action or field", () => {
    for (const doc of REVIEW_DOCS) {
      const text = readFileSync(doc, "utf8");
      for (const retired of [...RETIRED_ACTIONS, ...RETIRED_FIELDS]) {
        expect(text.includes(retired), `${doc} still mentions ${retired}`).toBe(false);
      }
    }
  });

  it("keeps the action matrix aligned with the live input schemas", () => {
    for (const tool of SURFACE_TOOLS) {
      const schema = tool.inputSchema as {
        properties?: Record<string, { enum?: unknown[] }>;
      };
      const live = (schema.properties?.["action"]?.enum ?? []).filter(
        (value): value is string => typeof value === "string",
      );
      expect(Object.keys(ACTION_MATRIX[tool.name] ?? {}).sort(), tool.name).toEqual(
        [...live].sort(),
      );
    }
  });

  it("uses only real actions in the machine-readable submission package", () => {
    const pkg = JSON.parse(readFileSync("docs/openai-submission-ready.json", "utf8")) as {
      tools: Array<{ name: string; actions?: string[]; public_actions?: string[] }>;
      starter_prompts: string[];
      review_status?: string;
    };
    const known = allActions();
    for (const tool of pkg.tools) {
      expect(tool.actions, `${tool.name} actions missing`).toEqual(
        Object.keys(ACTION_MATRIX[tool.name] ?? {}),
      );
      for (const action of tool.public_actions ?? []) expect(known).toContain(action);
    }
    // No prompt may advertise a field the schema does not accept.
    const prompts = pkg.starter_prompts.join(" ").toLowerCase();
    for (const retired of ["location", ...RETIRED_ACTIONS, ...RETIRED_FIELDS]) {
      expect(prompts.includes(retired), `starter prompt mentions ${retired}`).toBe(false);
    }
  });

  it("claims readiness without claiming approval", () => {
    for (const doc of REVIEW_DOCS) {
      const text = readFileSync(doc, "utf8");
      expect(/\b(approved by openai|openai-certified|certified by openai)\b/i.test(text), doc).toBe(
        false,
      );
    }
    const pkg = JSON.parse(readFileSync("docs/openai-submission-ready.json", "utf8")) as {
      review_status?: string;
    };
    expect(pkg.review_status).toBe(
      "code/review package ready; portal/external blockers outstanding",
    );
  });
});
