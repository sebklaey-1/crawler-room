import { describe, expect, it } from "vitest";

import { bearerToken, decodeJwtPayload, protectedResourceMetadata, challengeHeader } from "./auth";
import { AUTH_META_KEY, isAuthenticated, readAuthMeta, sanitizeClientMeta } from "./identity";
import { handleMcpRequest } from "./mcp";
import { isPublicAction, PUBLIC_ACTIONS, SURFACE_TOOLS } from "./mcp.surface";

const URL_MCP = "http://localhost/api/public/mcp";

function post(body: unknown, init: RequestInit = {}) {
  return handleMcpRequest(
    new Request(URL_MCP, {
      method: "POST",
      headers: { "content-type": "application/json", ...((init.headers ?? {}) as Record<string, string>) },
      body: JSON.stringify(body),
    }),
  );
}

function toolCall(name: string, args: Record<string, unknown>, headers?: Record<string, string>) {
  return post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { headers: headers ?? {} });
}

describe("authentication policy", () => {
  it("only allows side-effect-free reads without a token", () => {
    expect(PUBLIC_ACTIONS["likes"]).toEqual([]);
    expect(PUBLIC_ACTIONS["analytics"]).toEqual([]);
    expect(PUBLIC_ACTIONS["followers_notifications"]).toEqual([]);
    expect(isPublicAction("universal_room", "read")).toBe(true);
    expect(isPublicAction("universal_room", "send")).toBe(false);
    expect(isPublicAction("public_room", "open")).toBe(true);
    expect(isPublicAction("public_room", "send")).toBe(false);
    expect(isPublicAction("profile", "get")).toBe(true);
    expect(isPublicAction("profile", "block")).toBe(false);
    expect(isPublicAction("communities_organizations", "read_community")).toBe(true);
    expect(isPublicAction("communities_organizations", "send_community")).toBe(false);
  });

  it("declares a policy entry for every advertised tool", () => {
    for (const tool of SURFACE_TOOLS) expect(Array.isArray(PUBLIC_ACTIONS[tool.name])).toBe(true);
  });

  it("answers protected tool calls with 401 and an OAuth challenge", async () => {
    const response = await toolCall("likes", { action: "like", target_type: "profile", username: "someone" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="http://localhost/.well-known/oauth-protected-resource"',
    );
    const body = (await response.json()) as any;
    expect(body.result.structuredContent.error.code).toBe("AUTH_REQUIRED");
  });

  it("rejects an unsupported protocol version", async () => {
    const response = await post(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { headers: { "mcp-protocol-version": "1999-01-01" } },
    );
    expect(response.status).toBe(400);
  });

  it("rejects a foreign browser origin", async () => {
    const response = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { origin: "https://evil.test" } });
    expect(response.status).toBe(403);
  });

  it("rejects a wrong content type and oversized payloads", async () => {
    const wrongType = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { "content-type": "text/plain" } });
    expect(wrongType.status).toBe(415);

    const huge = await post({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(1024 * 1024 + 10) } });
    expect(huge.status).toBe(413);
  });

  it("advertises which actions need an account in tools/list", async () => {
    const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const body = (await response.json()) as any;
    const likes = body.result.tools.find((tool: any) => tool.name === "likes");
    expect(likes._meta["room/public_actions"]).toEqual([]);
    expect(likes._meta["room/authenticated_actions"]).toEqual(["like", "unlike"]);
    const universal = body.result.tools.find((tool: any) => tool.name === "universal_room");
    expect(universal.outputSchema.oneOf.map((branch: any) => branch.properties.action.const)).toEqual([
      "enter",
      "read",
      "send",
    ]);
  });
});

describe("test-only auth context", () => {
  it("accepts x-room-test-user while NODE_ENV is test", async () => {
    expect(process.env["NODE_ENV"]).toBe("test");
    const response = await toolCall(
      "likes",
      { action: "like", target_type: "profile", username: "someone" },
      { "x-room-test-user": "00000000-0000-4000-8000-000000000001" },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.result.structuredContent.error?.code).not.toBe("AUTH_REQUIRED");
  });

  it("rejects an invalid bearer token with an invalid_token challenge", async () => {
    const response = await toolCall(
      "likes",
      { action: "like", target_type: "profile", username: "someone" },
      { authorization: "Bearer not.a.token" },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("carries the challenge inside the tool result meta", async () => {
    const response = await toolCall("analytics", { action: "profile" });
    const body = (await response.json()) as any;
    expect(body.result._meta["mcp/www_authenticate"]).toContain("resource_metadata=");
    expect(body.result._meta["mcp/www_authenticate"]).toContain("error_description=");
  });

  it("advertises security schemes per tool", async () => {
    const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const body = (await response.json()) as any;
    for (const tool of body.result.tools) {
      expect(tool.securitySchemes).toEqual(tool._meta.securitySchemes);
      const types = tool.securitySchemes.map((scheme: any) => scheme.type);
      expect(types).toContain("oauth2");
      expect(types.includes("noauth")).toBe((PUBLIC_ACTIONS[tool.name] ?? []).length > 0);
    }
    for (const name of ["followers_notifications", "likes", "analytics"]) {
      const tool = body.result.tools.find((entry: any) => entry.name === name);
      expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes: ["openid", "profile"] }]);
    }
  });
});

describe("token and identity handling", () => {
  it("reads only well-formed bearer headers", () => {
    expect(bearerToken(new Request(URL_MCP, { headers: { authorization: "Bearer abc" } }))).toBe("abc");
    expect(bearerToken(new Request(URL_MCP, { headers: { authorization: "Basic abc" } }))).toBeNull();
    expect(bearerToken(new Request(URL_MCP))).toBeNull();
  });

  it("decodes a jwt payload without trusting it", () => {
    const payload = { sub: "user-1", exp: 1 };
    const token = `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;
    expect(decodeJwtPayload(token)).toMatchObject({ sub: "user-1" });
    expect(decodeJwtPayload("not-a-token")).toBeNull();
  });

  it("strips server-controlled meta keys sent by a client", () => {
    const meta = sanitizeClientMeta({
      "openai/subject": "abc",
      [AUTH_META_KEY]: { userId: "spoofed", subjectHash: "spoofed" },
      "room/origin": "https://evil.test",
    });
    expect(meta[AUTH_META_KEY]).toBeUndefined();
    expect(meta["room/origin"]).toBeUndefined();
    expect(meta["openai/subject"]).toBe("abc");
    expect(isAuthenticated(meta)).toBe(false);
  });

  it("accepts only complete auth contexts", () => {
    expect(readAuthMeta({ [AUTH_META_KEY]: { userId: "u", subjectHash: "s" } })).toEqual({
      userId: "u",
      subjectHash: "s",
    });
    expect(readAuthMeta({ [AUTH_META_KEY]: { userId: "u" } })).toBeNull();
    expect(readAuthMeta(undefined)).toBeNull();
  });
});

describe("protected resource discovery", () => {
  it("points at the project authorization server", () => {
    process.env["SUPABASE_URL"] ??= "https://example.supabase.co";
    const metadata = protectedResourceMetadata("https://room.example");
    expect(metadata.resource).toBe("https://room.example/api/public/mcp");
    expect(metadata.authorization_servers.length).toBe(1);
    expect(metadata.bearer_methods_supported).toEqual(["header"]);
  });

  it("builds a spec compliant challenge", () => {
    expect(challengeHeader("https://room.example", "invalid_token")).toBe(
      'Bearer resource_metadata="https://room.example/.well-known/oauth-protected-resource", error="invalid_token"',
    );
  });
});
