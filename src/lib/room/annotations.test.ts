/**
 * Contract tests for the public MCP surface metadata that OpenAI reviews:
 * exactly seven tools, complete and truthful annotations, explicit security
 * schemes, and an action/side-effect matrix that matches the real schemas.
 * Everything here is offline.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ACTION_MATRIX, annotationsFor } from "./actions.matrix";
import { PUBLIC_ACTIONS, SURFACE_TOOLS, TOOL_ANNOTATIONS } from "./mcp.surface";
import { SUPPORTED_SCOPES } from "./oauth/catalog";
import { scopesForTool } from "./oauth/scopes";

const EXPECTED_TOOLS = [
  "universal_room",
  "public_room",
  "profile",
  "followers_notifications",
  "likes",
  "analytics",
  "communities_organizations",
];

function actionsOf(tool: (typeof SURFACE_TOOLS)[number]): string[] {
  const schema = tool.inputSchema as {
    properties?: Record<string, { enum?: unknown[] }>;
  };
  const values = schema.properties?.["action"]?.enum ?? [];
  return values.filter((value): value is string => typeof value === "string");
}

describe("public tool surface", () => {
  it("exposes exactly the seven reviewed tools", () => {
    expect(SURFACE_TOOLS.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
  });

  it("carries all three behaviour hints on every tool", () => {
    for (const tool of SURFACE_TOOLS) {
      const annotations = tool.annotations as Record<string, unknown>;
      for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint", "idempotentHint"]) {
        expect(typeof annotations[hint], `${tool.name}.${hint}`).toBe("boolean");
      }
      expect(annotations).toEqual(TOOL_ANNOTATIONS[tool.name]);
    }
  });

  it("declares explicit security schemes per tool", () => {
    for (const tool of SURFACE_TOOLS) {
      const schemes = (tool.securitySchemes ?? []) as Array<{ type?: string; scopes?: string[] }>;
      expect(schemes.length, tool.name).toBeGreaterThan(0);
      const types = schemes.map((scheme) => scheme.type);
      expect(types, tool.name).toContain("oauth2");
      // noauth is advertised exactly when public read actions exist.
      expect(types.includes("noauth"), tool.name).toBe(
        (PUBLIC_ACTIONS[tool.name] ?? []).length > 0,
      );
      const oauth = schemes.find((scheme) => scheme.type === "oauth2");
      // Every tool asks for the two base scopes plus exactly the elevated
      // scopes its own actions need — never a scope outside the catalogue.
      const scopes = oauth?.scopes ?? [];
      expect(scopes.slice(0, 2), tool.name).toEqual(["openid", "profile"]);
      const allowedScopes: string[] = [...SUPPORTED_SCOPES];
      expect(
        scopes.every((scope) => allowedScopes.includes(scope)),
        tool.name,
      ).toBe(true);

      expect(scopes, tool.name).toEqual(scopesForTool(tool.name));
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

  it("keeps every public action side-effect free in the matrix", () => {
    for (const [tool, actions] of Object.entries(PUBLIC_ACTIONS)) {
      for (const action of actions) {
        expect(ACTION_MATRIX[tool]?.[action]?.write, `${tool}.${action}`).toBe(false);
      }
    }
  });
});

describe("submission package", () => {
  const pkg = JSON.parse(readFileSync("docs/openai-submission-ready.json", "utf8")) as {
    tools: Array<{
      name: string;
      annotations: Record<string, boolean>;
      securitySchemes: unknown[];
    }>;
    starter_prompts: string[];
    test_cases: { positive: unknown[]; negative: unknown[] };
  };

  it("documents the same annotations and schemes as the live surface", () => {
    expect(pkg.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
    for (const tool of pkg.tools) {
      const live = SURFACE_TOOLS.find((entry) => entry.name === tool.name)!;
      expect(tool.annotations, tool.name).toEqual(live.annotations);
      expect(tool.securitySchemes, tool.name).toEqual(live.securitySchemes);
    }
  });

  it("ships the required reviewer material", () => {
    expect(pkg.starter_prompts.length).toBeGreaterThanOrEqual(6);
    expect(pkg.starter_prompts.length).toBeLessThanOrEqual(10);
    expect(pkg.test_cases.positive.length).toBe(5);
    expect(pkg.test_cases.negative.length).toBeGreaterThanOrEqual(3);
  });
});
