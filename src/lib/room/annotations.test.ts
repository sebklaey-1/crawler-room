/**
 * Contract tests for the public MCP surface metadata that OpenAI reviews:
 * exactly one tool, complete and truthful annotations, and an action /
 * side-effect matrix that matches the real schemas. Everything here is offline.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ACTION_MATRIX, annotationsFor } from "./actions.matrix";
import { PUBLIC_ACTIONS, SURFACE_TOOLS, TOOL_ANNOTATIONS } from "./mcp.surface";

const EXPECTED_TOOLS = ["universal_room"];

function actionsOf(tool: (typeof SURFACE_TOOLS)[number]): string[] {
  const schema = tool.inputSchema as {
    properties?: Record<string, { enum?: unknown[] }>;
  };
  const values = schema.properties?.["action"]?.enum ?? [];
  return values.filter((value): value is string => typeof value === "string");
}

describe("public tool surface", () => {
  it("exposes exactly the reviewed tool", () => {
    expect(SURFACE_TOOLS.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
  });

  it("carries all behaviour hints on every tool", () => {
    for (const tool of SURFACE_TOOLS) {
      const annotations = tool.annotations as Record<string, unknown>;
      for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint", "idempotentHint"]) {
        expect(typeof annotations[hint], `${tool.name}.${hint}`).toBe("boolean");
      }
      expect(annotations).toEqual(TOOL_ANNOTATIONS[tool.name]);
    }
  });

  it("needs no sign-in: every action is publicly callable", () => {
    for (const tool of SURFACE_TOOLS) {
      expect(PUBLIC_ACTIONS[tool.name]?.slice().sort(), tool.name).toEqual(actionsOf(tool).sort());
    }
  });
});

describe("action/side-effect matrix", () => {
  it("covers exactly the actions the input schemas accept", () => {
    for (const tool of SURFACE_TOOLS) {
      const declared = Object.keys(ACTION_MATRIX[tool.name] ?? {}).sort();
      expect(declared, tool.name).toEqual(actionsOf(tool).sort());
    }
  });

  it("never marks a mixed read/write tool as read-only", () => {
    for (const tool of SURFACE_TOOLS) {
      const effects = Object.values(ACTION_MATRIX[tool.name]!);
      const annotations = tool.annotations as Record<string, boolean>;
      if (effects.some((effect) => effect.write)) expect(annotations["readOnlyHint"]).toBe(false);
      if (effects.some((effect) => effect.publicEffect))
        expect(annotations["openWorldHint"], tool.name).toBe(true);
      if (effects.some((effect) => effect.destructive))
        expect(annotations["destructiveHint"], tool.name).toBe(true);
      expect(annotations).toEqual(annotationsFor(tool.name));
    }
  });
});

describe("submission package", () => {
  const pkg = JSON.parse(readFileSync("docs/openai-submission-ready.json", "utf8")) as {
    tools: Array<{ name: string; annotations: Record<string, boolean> }>;
    starter_prompts: string[];
    test_cases: { positive: unknown[]; negative: unknown[] };
  };

  it("documents the same annotations as the live surface", () => {
    expect(pkg.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
    for (const tool of pkg.tools) {
      const live = SURFACE_TOOLS.find((entry) => entry.name === tool.name)!;
      expect(tool.annotations, tool.name).toEqual(live.annotations);
    }
  });

  it("ships the required reviewer material", () => {
    expect(pkg.starter_prompts.length).toBeGreaterThanOrEqual(4);
    expect(pkg.starter_prompts.length).toBeLessThanOrEqual(10);
    expect(pkg.test_cases.positive.length).toBeGreaterThanOrEqual(3);
    expect(pkg.test_cases.negative.length).toBeGreaterThanOrEqual(3);
  });
});
