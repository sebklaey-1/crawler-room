import { asRecord, branchesOf } from "./jsonschema";

/** The `tools` array of a `tools/list` response body. */
function toolList(body: unknown): unknown[] {
  return (asRecord(asRecord(body)["result"])["tools"] ?? []) as unknown[];
}
import { afterEach, describe, expect, it } from "vitest";

import {
  bearerToken,
  protectedResourceMetadata,
  challengeHeader,
  canonicalResource,
  resourceMetadataUrl,
  PRODUCTION_MCP_RESOURCE,
  verifyAccessToken,
  __setTestClaimsVerifier,
} from "./auth";
import { AUTH_META_KEY, isAuthenticated, readAuthMeta, sanitizeClientMeta } from "./identity";
import { handleMcpRequest } from "./mcp";
import { __setTestDb } from "./store";
import { fakeDb } from "@/test/fake-db";
import { isPublicAction, PUBLIC_ACTIONS, SURFACE_TOOLS } from "./mcp.surface";

const URL_MCP = "http://localhost/mcp";

function post(body: unknown, init: RequestInit = {}) {
  return handleMcpRequest(
    new Request(URL_MCP, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...((init.headers ?? {}) as Record<string, string>),
      },
      body: JSON.stringify(body),
    }),
  );
}

function toolCall(name: string, args: Record<string, unknown>, headers?: Record<string, string>) {
  return post(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    { headers: headers ?? {} },
  );
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
    const response = await toolCall("likes", {
      action: "like",
      target_type: "profile",
      username: "someone",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"',
    );
    const body = await response.json();
    expect(body.result.structuredContent.error.code).toBe("AUTH_REQUIRED");
    const challenge = body.result._meta["mcp/www_authenticate"];
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain("error_description=");
  });

  it("rejects an unsupported protocol version", async () => {
    const response = await post(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { headers: { "mcp-protocol-version": "1999-01-01" } },
    );
    expect(response.status).toBe(400);
  });

  it("rejects a foreign browser origin", async () => {
    const response = await post(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { headers: { origin: "https://evil.test" } },
    );
    expect(response.status).toBe(403);
  });

  it("rejects a wrong content type and oversized payloads", async () => {
    const wrongType = await post(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { headers: { "content-type": "text/plain" } },
    );
    expect(wrongType.status).toBe(415);

    // Multi-byte characters count as real UTF-8 bytes, not string length.
    const huge = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: { pad: "ä".repeat(140 * 1024) },
    });
    expect(huge.status).toBe(413);
  });

  it("advertises which actions need an account in tools/list", async () => {
    const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = toolList(await response.json());
    const likes = asRecord(tools.find((tool) => asRecord(tool)["name"] === "likes"));
    const likesMeta = asRecord(likes["_meta"]);
    expect(likesMeta["room/public_actions"]).toEqual([]);
    expect(likesMeta["room/authenticated_actions"]).toEqual(["like", "unlike"]);
    const universal = asRecord(tools.find((tool) => asRecord(tool)["name"] === "universal_room"));
    expect(
      branchesOf(universal["outputSchema"]).map((branch) => branch.properties?.["action"]?.const),
    ).toEqual(["enter", "read", "send", "report"]);
    const universalMeta = asRecord(universal["_meta"]);
    expect(universalMeta["room/public_actions"]).toEqual(["read"]);
    // Reporting is a safety action and always needs a verified OAuth identity.
    expect(universalMeta["room/authenticated_actions"]).toContain("report");
  });
});

describe("test-only auth context", () => {
  // The whole point of this block is that the request is *accepted*; it must
  // never reach a real database. A fake db is injected for the single call and
  // removed again afterwards.
  afterEach(() => __setTestDb(null));

  it("accepts x-room-test-user while NODE_ENV is test", async () => {
    expect(process.env["NODE_ENV"]).toBe("test");
    __setTestDb(fakeDb());
    const response = await toolCall(
      "likes",
      { action: "like", target_type: "profile", username: "someone" },
      { "x-room-test-user": "00000000-0000-4000-8000-000000000001" },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
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
    const body = await response.json();
    expect(body.result._meta["mcp/www_authenticate"]).toContain("resource_metadata=");
    expect(body.result._meta["mcp/www_authenticate"]).toContain("error_description=");
  });

  it("advertises security schemes per tool", async () => {
    const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = toolList(await response.json());
    for (const entry of tools) {
      const tool = asRecord(entry);
      const schemes = (tool["securitySchemes"] ?? []) as Array<{ type?: string }>;
      expect(schemes).toEqual(asRecord(tool["_meta"])["securitySchemes"]);
      const types = schemes.map((scheme) => scheme.type);
      expect(types).toContain("oauth2");
      expect(types.includes("noauth")).toBe(
        (PUBLIC_ACTIONS[String(tool["name"])] ?? []).length > 0,
      );
    }
    for (const name of ["followers_notifications", "likes", "analytics"]) {
      const tool = asRecord(tools.find((entry) => asRecord(entry)["name"] === name));
      expect(tool["securitySchemes"]).toEqual([{ type: "oauth2", scopes: ["openid", "profile"] }]);
    }
  });
});

describe("token and identity handling", () => {
  it("reads only well-formed bearer headers", () => {
    expect(bearerToken(new Request(URL_MCP, { headers: { authorization: "Bearer abc" } }))).toBe(
      "abc",
    );
    expect(
      bearerToken(new Request(URL_MCP, { headers: { authorization: "Basic abc" } })),
    ).toBeNull();
    expect(bearerToken(new Request(URL_MCP))).toBeNull();
  });

  it("strips server-controlled meta keys sent by a client", () => {
    const meta = sanitizeClientMeta({
      "openai/subject": "abc",
      [AUTH_META_KEY]: { subjectHash: "spoofed" },
      "room/origin": "https://evil.test",
    });
    expect(meta[AUTH_META_KEY]).toBeUndefined();
    expect(meta["room/origin"]).toBeUndefined();
    expect(meta["openai/subject"]).toBe("abc");
    expect(isAuthenticated(meta)).toBe(false);
  });

  it("carries only the pseudonymous subject, never a raw account id", () => {
    expect(readAuthMeta({ [AUTH_META_KEY]: { subjectHash: "s" } })).toEqual({ subjectHash: "s" });
    expect(readAuthMeta({ [AUTH_META_KEY]: { userId: "u" } })).toBeNull();
    expect(readAuthMeta(undefined)).toBeNull();
  });
});

describe("protected resource discovery", () => {
  it("points at the project authorization server", () => {
    process.env["SUPABASE_URL"] ??= "https://example.supabase.co";
    const metadata = protectedResourceMetadata("https://room.example");
    expect(metadata.resource).toBe("https://room.example/mcp");
    expect(metadata.authorization_servers).toEqual([`${process.env["SUPABASE_URL"]}/auth/v1`]);
    expect(metadata.scopes_supported).toEqual(["openid", "profile"]);
    expect(metadata.bearer_methods_supported).toEqual(["header"]);
  });

  it("prefers the configured production resource over any request origin", () => {
    process.env["ROOM_MCP_RESOURCE"] = PRODUCTION_MCP_RESOURCE;
    try {
      expect(PRODUCTION_MCP_RESOURCE).toBe("https://crawler.today/mcp");
      expect(canonicalResource("https://evil.test")).toBe(PRODUCTION_MCP_RESOURCE);
      expect(protectedResourceMetadata("https://evil.test").resource).toBe(PRODUCTION_MCP_RESOURCE);
      expect(challengeHeader("https://evil.test")).toBe(
        'Bearer resource_metadata="https://crawler.today/.well-known/oauth-protected-resource/mcp"',
      );
    } finally {
      delete process.env["ROOM_MCP_RESOURCE"];
    }
  });

  it("rejects the retired zinga resource and any foreign configuration", () => {
    for (const wrong of [
      "https://zinga-room.lovable.app/mcp",
      "https://evil.test/mcp",
      "http://crawler.today/mcp",
      "https://crawler.today/api/public/mcp",
    ]) {
      process.env["ROOM_MCP_RESOURCE"] = wrong;
      try {
        expect(() => canonicalResource("https://crawler.today")).toThrow();
      } finally {
        delete process.env["ROOM_MCP_RESOURCE"];
      }
    }
  });

  it("falls back to the production resource when nothing is configured", () => {
    expect(canonicalResource()).toBe(PRODUCTION_MCP_RESOURCE);
    expect(resourceMetadataUrl()).toBe(
      "https://crawler.today/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("builds a spec compliant challenge", () => {
    expect(challengeHeader("https://room.example", "invalid_token")).toBe(
      'Bearer resource_metadata="https://room.example/.well-known/oauth-protected-resource/mcp", error="invalid_token"',
    );
  });
});

/* ----------------------------- claim validation ---------------------------- */

const RESOURCE = "http://localhost/mcp";

function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: `${process.env["SUPABASE_URL"]}/auth/v1`,
    sub: "00000000-0000-4000-8000-0000000000aa",
    exp: Math.floor(Date.now() / 1000) + 600,
    client_id: "mcp-client",
    aud: [RESOURCE],
    room_resource: RESOURCE,
    room_scopes: ["openid", "profile"],
    ...overrides,
  };
}

function stub(overrides: Record<string, unknown> = {}) {
  __setTestClaimsVerifier(async () => claims(overrides));
}

describe("access token claim validation", () => {
  afterEach(() => __setTestClaimsVerifier(null));

  it("accepts a fully resource-bound token", async () => {
    process.env["SUPABASE_URL"] ??= "https://example.supabase.co";
    stub();
    const user = await verifyAccessToken("token-ok", "http://localhost");
    expect(user.userId).toBe("00000000-0000-4000-8000-0000000000aa");
    expect(user.clientId).toBe("mcp-client");
  });

  it("accepts a token that carries the resource only in room_resource", async () => {
    stub({ aud: "authenticated", room_scopes: undefined, scope: "openid profile" });
    const user = await verifyAccessToken("token-hook-bound", "http://localhost");
    expect(user.clientId).toBe("mcp-client");
    expect(user.scopes).toEqual(["openid", "profile"]);
  });

  it("accepts a plain authorization-server session token without client_id or resource", async () => {
    stub({ client_id: "", aud: "authenticated", room_resource: undefined, scope: undefined, room_scopes: undefined });
    const user = await verifyAccessToken("token-session", "http://localhost");
    expect(user.userId).toBe("00000000-0000-4000-8000-0000000000aa");
    expect(user.scopes).toEqual(["openid", "profile"]);
  });

  const rejected: Array<[string, Record<string, unknown>]> = [
    ["a foreign issuer", { iss: "https://evil.test/auth/v1" }],
    ["a non-uuid subject", { sub: "not-a-uuid" }],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 10 }],
    ["a wrong audience", { aud: ["https://other.test/mcp"], room_resource: undefined }],

    ["a token bound to another resource", { room_resource: "https://other.test/mcp" }],
    [
      "a token bound to the retired /api/public/mcp resource",
      {
        aud: ["http://localhost/api/public/mcp"],
        room_resource: "http://localhost/api/public/mcp",
      },
    ],
    ["a token without the required scopes", { room_scopes: undefined, scope: "openid" }],
  ];


  for (const [label, overrides] of rejected) {
    it(`rejects ${label}`, async () => {
      stub(overrides);
      await expect(verifyAccessToken(`token-${label}`, "http://localhost")).rejects.toMatchObject({
        code: "INVALID_TOKEN",
      });
    });
  }
});

/* ------------------------- transport hardening ---------------------------- */

describe("streamable http hardening", () => {
  it("requires a content type on POST", async () => {
    const response = await handleMcpRequest(
      new Request(URL_MCP, { method: "POST", body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' }),
    );
    expect(response.status).toBe(415);
  });

  it("sets security headers on every response", async () => {
    const response = await post({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("rejects an empty and an oversized batch", async () => {
    expect((await post([])).status).toBe(400);
    const many = Array.from({ length: 11 }, (_unused, index) => ({
      jsonrpc: "2.0",
      id: index,
      method: "ping",
    }));
    expect((await post(many)).status).toBe(400);
  });

  it("rejects malformed json-rpc envelopes with -32600", async () => {
    const bad = [
      { jsonrpc: "1.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "" },
      { jsonrpc: "2.0", id: 3, method: "ping", params: "nope" },
      { jsonrpc: "2.0", id: { bad: true }, method: "ping" },
    ];
    for (const message of bad) {
      const body = await (await post(message)).json();
      expect(body.error.code).toBe(-32600);
    }
  });

  it("answers a parse error with -32700", async () => {
    const response = await handleMcpRequest(
      new Request(URL_MCP, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32700);
  });

  it("isolates batch entries so one auth failure never leaks", async () => {
    const response = await post([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "analytics", arguments: { action: "profile" } },
      },
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
    ]);
    const body = (await response.json()) as Array<Record<string, unknown>>;
    const byId = (id: number) => asRecord(body.find((entry) => entry["id"] === id));
    const ping = byId(1);
    const analytics = byId(2);
    const list = byId(3);
    expect(ping["result"]).toEqual({});
    expect(
      asRecord(asRecord(asRecord(analytics["result"])["structuredContent"])["error"])["code"],
    ).toBe("AUTH_REQUIRED");
    expect((asRecord(list["result"])["tools"] as unknown[]).length).toBe(7);
  });

  it("accepts application/json with a charset", async () => {
    const response = await post(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { headers: { "content-type": "application/json; charset=utf-8" } },
    );
    expect(response.status).toBe(200);
  });
});
