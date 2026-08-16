import { describe, expect, it } from "vitest";

import { handleMcpRequest } from "./mcp";
import { SURFACE_TOOLS } from "./mcp.surface";
import { toRoomError } from "./errors";

const EXPECTED = [
  "universal_room",
  "public_room",
  "profile",
  "followers_notifications",
  "likes",
  "analytics",
  "communities_organizations",
];

const REMOVED = [
  "list_topics",
  "enter_topic",
  "send_message",
  "read_messages",
  "my_rooms",
  "leave_topic",
  "report_message",
  "create_private_room",
  "create_invitation",
  "join_invitation",
  "get_my_plan",
  "create_sponsored_campaign",
  "manage_campaign",
  "enter_universal",
  "my_room",
  "follow_room",
  "get_profile",
  "like_content",
  "profile_analytics",
];

async function rpc(method: string, params?: unknown) {
  const response = await handleMcpRequest(
    new Request("http://localhost/api/public/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  return (await response.json()) as any;
}

async function callTool(name: string, args: unknown, meta?: Record<string, unknown>) {
  const body = await rpc("tools/call", { name, arguments: args, ...(meta ? { _meta: meta } : {}) });
  return body.result;
}

describe("MCP surface", () => {
  it("initializes and advertises the seven product areas", async () => {
    const body = await rpc("initialize", { protocolVersion: "2025-06-18" });
    expect(body.result.serverInfo.title).toBe("@room");
    for (const name of EXPECTED) expect(body.result.instructions).toContain(name);
    expect(body.result.instructions).not.toMatch(/Kampagne|Sponsor|Abonnement|Bezahlung/);
  });

  it("lists exactly the seven grouped tools", async () => {
    const body = await rpc("tools/list");
    const names = body.result.tools.map((tool: any) => tool.name);
    expect(names).toEqual(EXPECTED);
    expect(names).toHaveLength(7);
    for (const removed of REMOVED) expect(names).not.toContain(removed);
  });

  it("keeps every input schema strict and action-driven", () => {
    for (const tool of SURFACE_TOOLS) {
      expect((tool.inputSchema as any).additionalProperties).toBe(false);
      expect((tool.inputSchema as any).required).toContain("action");
      expect((tool.inputSchema as any).properties.action.enum.length).toBeGreaterThan(0);
      // Identity is never a tool input.
      expect(Object.keys((tool.inputSchema as any).properties)).not.toContain("subject");
      expect(JSON.stringify(tool.inputSchema)).not.toContain("openai/subject");
    }
  });

  it("derives every input schema from the validating zod schema", () => {
    for (const tool of SURFACE_TOOLS) {
      const properties = (tool.inputSchema as any).properties as Record<string, any>;
      for (const field of Object.values(properties)) {
        // Every string field carries the same limit the server enforces.
        if (field.type === "string" && !field.enum) {
          expect(typeof field.maxLength).toBe("number");
        }
      }
    }
  });

  it("declares strict per-action output branches without internal identifiers", () => {
    for (const tool of SURFACE_TOOLS) {
      const branches = (tool.outputSchema as any).oneOf as any[];
      const actions = (tool.inputSchema as any).properties.action.enum as string[];
      expect(branches.map((branch) => branch.title).sort()).toEqual([...actions].sort());
      for (const branch of branches) {
        expect(branch.properties.action.const).toBe(branch.title);
        expect(branch.required).toContain("action");
      }
      const text = JSON.stringify(tool.outputSchema).toLowerCase();
      for (const forbidden of [
        "subject_hash",
        "account_id",
        "room_id",
        "membership_id",
        "storage_path",
        "auth_user",
      ]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });

  it("never mentions ads, campaigns, plans or events in the public surface", () => {
    const text = JSON.stringify(
      SURFACE_TOOLS.map((tool) => [tool.name, tool.title, tool.description]),
    );
    for (const forbidden of [
      "campaign",
      "sponsor",
      "kampagne",
      "abonnement",
      "preis",
      "poll",
      "einladung",
    ]) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("rejects an unknown tool", async () => {
    const result = await callTool("enter_topic", { topic: "ai" });
    expect(result.isError).toBe(true);
  });

  it("requires a validated OAuth identity for every non-public action", async () => {
    for (const [name, args] of [
      ["universal_room", { action: "enter" }],
      ["public_room", { action: "mine" }],
      ["profile", { action: "update", bio: "hi" }],
      ["followers_notifications", { action: "list_following" }],
      ["likes", { action: "like", target_type: "profile", username: "someone" }],
      ["analytics", { action: "profile" }],
      ["communities_organizations", { action: "create_community", title: "Test" }],
    ] as const) {
      const result = await callTool(name, args);
      expect(result.isError, name).toBe(true);
      expect(result.structuredContent.error.code, name).toBe("AUTH_REQUIRED");
    }
  });

  it("refuses a raw subject passed as tool input", async () => {
    const result = await callTool("public_room", { action: "mine", "openai/subject": "user-123" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe("INVALID_INPUT");
  });

  it("validates the action discriminator of every tool", async () => {
    for (const tool of SURFACE_TOOLS) {
      const result = await callTool(tool.name, { action: "definitely_not_an_action" });
      expect(result.structuredContent.error.code, tool.name).toBe("INVALID_INPUT");
    }
  });

  it("validates required arguments per action before touching data", async () => {
    const meta = { "openai/subject": "test-subject" };
    const cases: Array<[string, Record<string, unknown>]> = [
      ["universal_room", { action: "send" }],
      ["public_room", { action: "open" }],
      ["profile", { action: "change_handle" }],
      ["followers_notifications", { action: "follow" }],
      ["likes", { action: "like", target_type: "message" }],
      ["communities_organizations", { action: "get_community" }],
    ];
    for (const [name, args] of cases) {
      const result = await callTool(name, args, meta);
      expect(result.isError, `${name}/${String(args["action"])}`).toBe(true);
    }
  });

  it("maps unexpected failures to safe internal errors", () => {
    const error = toRoomError(new Error("select * from secrets"));
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.message).not.toContain("select");
  });
});
