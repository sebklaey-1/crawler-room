/**
 * Regression gate for the two claims the OpenAI review depends on:
 *
 * 1. every non-public action fails closed with AUTH_REQUIRED when no bearer
 *    token was validated, and
 * 2. public reads are side-effect free — they run under the synthetic
 *    anonymous subject and never touch presence, membership or analytics.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ACTION_MATRIX } from "./actions.matrix";
import { isPublicAction, PUBLIC_ACTIONS, SURFACE_TOOLS } from "./mcp.surface";
import { requiredScope } from "./oauth/scopes";

const SURFACE = readFileSync("src/lib/room/mcp.surface.ts", "utf8");

describe("write actions require a validated token", () => {
  it("rejects every non-public action without auth", async () => {
    for (const tool of SURFACE_TOOLS) {
      for (const action of Object.keys(ACTION_MATRIX[tool.name] ?? {})) {
        if (isPublicAction(tool.name, action)) continue;
        await expect(
          tool.handler({ action }, { "room/origin": "https://crawler.today" }),
          `${tool.name}.${action}`,
        ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
      }
    }
  });

  it("maps every state-changing action to the write scope", () => {
    for (const [tool, actions] of Object.entries(ACTION_MATRIX)) {
      for (const [action, effect] of Object.entries(actions)) {
        const scope = requiredScope(tool, action);
        if (isPublicAction(tool, action)) {
          expect(scope, `${tool}.${action}`).toBeNull();
          // a public action may never write
          expect(effect.write, `${tool}.${action}`).toBe(false);
          continue;
        }
        expect(scope, `${tool}.${action}`).toBe(effect.write ? "room:write" : "room:private");
      }
    }
  });
});

describe("public reads stay side-effect free", () => {
  it("declares only read actions as public", () => {
    for (const [tool, actions] of Object.entries(PUBLIC_ACTIONS)) {
      for (const action of actions) {
        expect(ACTION_MATRIX[tool]?.[action]).toEqual({
          write: false,
          publicEffect: false,
          destructive: false,
        });
      }
    }
  });

  it("routes anonymous callers through the synthetic subject", () => {
    expect(SURFACE).toContain('const ANONYMOUS_SUBJECT = "anonymous:public-read"');
    // No anonymous branch may record presence or analytics.
    const anonymousBlocks = SURFACE.split("ANONYMOUS_SUBJECT").slice(1);
    for (const block of anonymousBlocks) {
      const window = block.slice(0, 600);
      for (const effect of ["touchPresence(", "recordEvent(", "joinUniversal(", "ensureRoom("]) {
        expect(window.includes(effect), `anonymous path calls ${effect}`).toBe(false);
      }
    }
  });
});
