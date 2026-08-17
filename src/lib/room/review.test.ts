/**
 * OpenAI review metadata quality gate.
 *
 * Static, offline contract over the published MCP surface: names, tool
 * descriptions, input minimisation, output minimisation and the annotation /
 * security-scheme matrix. A change that would make the listing fail review
 * fails here first.
 */
import { describe, expect, it } from "vitest";

import { actionEnum, branchesOf, propertiesOf, schemaOf } from "./jsonschema";
import { PUBLIC_ACTIONS, SURFACE_TOOLS, securitySchemesFor } from "./mcp.surface";
import { enforceOutputContract } from "./output";

const EXPECTED = [
  "universal_room",
  "public_room",
  "profile",
  "followers_notifications",
  "likes",
  "analytics",
  "communities",
];

/** Broad "just in case" context inputs a reviewer flags immediately. */
const FORBIDDEN_INPUT_FIELDS = [
  "context",
  "history",
  "conversation",
  "conversation_history",
  "transcript",
  "messages_history",
  "metadata",
  "meta",
  "_meta",
  "user_id",
  "subject",
  "session",
  "session_id",
  "token",
  "access_token",
  "api_key",
  "password",
  "email",
  "phone",
  "raw",
  "payload",
  "data_blob",
];

/** Internal identifiers, telemetry and secrets that must never be returned. */
const FORBIDDEN_OUTPUT_KEYS =
  /(subject_hash|auth_user|owner_account|account_id|membership_id|room_id|community_id|organization_id|storage_path|bucket|request_id|trace_id|span_id|correlation_id|session_id|client_id|client_secret|access_token|refresh_token|service_role|sqlstate|stack|db_error|details_internal|queue_id|cron)/i;

/** Promotional or model-steering language that biases tool selection. */
const PROMOTIONAL =
  /\b(best|greatest|official|officially|prefer(red)?|always use|must use|superior|number one|#1|better than|instead of other|recommended tool|world'?s)\b/i;

const ENDORSEMENT = /\b(made by openai|openai[- ]approved|endorsed by openai|official openai)\b/i;

const AGE_CLAIMS =
  /\b(18\+|adult only|adults only|nsfw|xxx|dating|for kids|for children|ages? 8)\b/i;

const ACTION_VERB =
  /^(Reads|Opens|Lists|Manages|Adds|Returns|Creates|Sends|Posts|Follows|Reports|Fetches|Updates)\b/;

describe("OpenAI review metadata gate", () => {
  it("publishes exactly the seven unique tool names", () => {
    const names = SURFACE_TOOLS.map((tool) => tool.name);
    expect(names).toEqual(EXPECTED);
    expect(new Set(names).size).toBe(7);
  });

  it("describes each tool with a concrete action verb and no promotional language", () => {
    for (const tool of SURFACE_TOOLS) {
      expect(tool.title.length, tool.name).toBeGreaterThan(3);
      expect(tool.description.length, tool.name).toBeGreaterThan(80);
      // The technical names are nouns, so the first sentence must carry the verbs.
      expect(tool.description, tool.name).toMatch(ACTION_VERB);
      expect(tool.description, tool.name).not.toMatch(PROMOTIONAL);
      expect(tool.description, tool.name).not.toMatch(ENDORSEMENT);
      expect(tool.description, tool.name).not.toMatch(AGE_CLAIMS);
      // Every published action is actually mentioned in the description.
      for (const action of actionEnum(tool.inputSchema)) {
        expect(tool.description, `${tool.name}/${action}`).toContain(action);
      }
    }
  });

  it("keeps input schemas narrow and free of broad context or identity fields", () => {
    for (const tool of SURFACE_TOOLS) {
      const schema = schemaOf(tool.inputSchema);
      expect(schema.additionalProperties, tool.name).toBe(false);
      expect(schema.required, tool.name).toContain("action");
      const keys = Object.keys(propertiesOf(tool.inputSchema));
      for (const forbidden of FORBIDDEN_INPUT_FIELDS) {
        expect(keys, `${tool.name}.${forbidden}`).not.toContain(forbidden);
      }
      // Every free-text field carries an explicit, predictable maximum length.
      for (const [key, field] of Object.entries(propertiesOf(tool.inputSchema))) {
        if (field.type === "string" && !field.enum) {
          expect(typeof field.maxLength, `${tool.name}.${key}`).toBe("number");
        }
      }
    }
  });

  it("publishes a parsable per-action output schema without internal fields", () => {
    for (const tool of SURFACE_TOOLS) {
      const branches = branchesOf(tool.outputSchema);
      expect(branches.length, tool.name).toBe(actionEnum(tool.inputSchema).length);
      const text = JSON.stringify(tool.outputSchema);
      expect(FORBIDDEN_OUTPUT_KEYS.test(text), `${tool.name}: ${text.slice(0, 120)}`).toBe(false);
      for (const branch of branches) {
        expect(branch.required, tool.name).toContain("action");
        expect(branch.additionalProperties, tool.name).toBe(false);
      }
    }
  });

  it("strips internal identifiers from a handler result before it leaves the server", () => {
    const tool = SURFACE_TOOLS.find((entry) => entry.name === "likes")!;
    const reduced = enforceOutputContract(tool.outputSchema, {
      action: "like",
      liked: true,
      likes: 3,
      target_type: "profile",
      message: "Liked.",
      // everything below is internal and must not survive
      subject_hash: "abc",
      auth_user_id: "00000000-0000-4000-8000-00000000000a",
      request_id: "req_1",
      trace_id: "tr_1",
      storage_path: "room-images/x.png",
      stack: "Error: boom",
    });
    expect(JSON.stringify(reduced)).not.toMatch(FORBIDDEN_OUTPUT_KEYS);
    expect(reduced).toMatchObject({ action: "like", liked: true, likes: 3 });
  });

  it("declares complete annotations and explicit security schemes", () => {
    for (const tool of SURFACE_TOOLS) {
      for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint"]) {
        expect(typeof tool.annotations[hint], `${tool.name}.${hint}`).toBe("boolean");
      }
      const schemes = tool.securitySchemes ?? securitySchemesFor(tool.name);
      expect(schemes.length, tool.name).toBeGreaterThan(0);
      const types = schemes.map((scheme) => (scheme as { type?: string }).type);
      expect(types, tool.name).toContain("oauth2");
      const hasPublicAction = (PUBLIC_ACTIONS[tool.name] ?? []).length > 0;
      expect(types.includes("noauth"), tool.name).toBe(hasPublicAction);
    }
  });

  it("never advertises the deprecated resource path in active tool metadata", () => {
    const text = JSON.stringify(
      SURFACE_TOOLS.map((tool) => [tool.description, tool.inputSchema, tool.outputSchema]),
    );
    expect(text).not.toContain("/api/public/mcp");
  });
});
