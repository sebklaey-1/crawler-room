/**
 * Phase 2 contract tests: annotations, output minimisation, SSRF URL rules and
 * input parity. Everything here is offline — no external network calls.
 */
import { describe, expect, it } from "vitest";

import { enforceOutputContract } from "./output";
import { SURFACE_TOOLS, TOOL_ANNOTATIONS, isSafeImageUrl, isSafeWebsite } from "./mcp.surface";
import { checkImageUrl, isPrivateIpv4, isPrivateIpv6 } from "./ssrf";

const EXPECTED_ANNOTATIONS: Record<
  string,
  {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
    idempotentHint: boolean;
  }
> = {
  universal_room: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
    idempotentHint: false,
  },
  public_room: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
    idempotentHint: false,
  },
  profile: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
    idempotentHint: false,
  },
  followers_notifications: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
    idempotentHint: false,
  },
  likes: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
    idempotentHint: false,
  },
  analytics: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
  },
  communities_organizations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
    idempotentHint: false,
  },
};

describe("tool annotations", () => {
  it("matches the reviewed values exactly", () => {
    for (const [tool, expected] of Object.entries(EXPECTED_ANNOTATIONS)) {
      expect(TOOL_ANNOTATIONS[tool], tool).toMatchObject(expected);
    }
  });

  it("keeps titles and descriptions free of marketing or endorsement claims", () => {
    for (const tool of SURFACE_TOOLS) {
      const text = `${tool.title ?? ""} ${tool.description}`.toLowerCase();
      for (const banned of ["openai recommend", "partner", "official openai", "best app"]) {
        expect(text.includes(banned), `${tool.name}: ${banned}`).toBe(false);
      }
    }
  });
});

describe("output contract", () => {
  const schema = {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["action", "sent"],
        properties: {
          action: { const: "send" },
          sent: { type: "boolean" },
          messages: { type: "array" },
        },
      },
    ],
  };

  it("drops undeclared internal fields", () => {
    const reduced = enforceOutputContract(schema, {
      action: "send",
      sent: true,
      messages: [],
      account_id: "5b1c9f9a-0000-4000-8000-000000000000",
      subject_hash: "deadbeef",
      storage_path: "room-images/abc.png",
    }) as Record<string, unknown>;
    expect(Object.keys(reduced).sort()).toEqual(["action", "messages", "sent"]);
  });

  it("rejects a payload that does not match any branch", () => {
    expect(() => enforceOutputContract(schema, { action: "unknown" })).toThrow();
  });
});

describe("ssrf url rules", () => {
  it("accepts a public https url", () => {
    expect(checkImageUrl("https://example.com/a.png").ok).toBe(true);
  });

  it.each([
    "http://example.com/a.png",
    "https://localhost/a.png",
    "https://127.0.0.1/a.png",
    "https://10.0.0.5/a.png",
    "https://192.168.1.4/a.png",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/a.png",
    "https://[fe80::1]/a.png",
    "https://example.com:8080/a.png",
    "https://user:pw@example.com/a.png",
    "https://printer.local/a.png",
  ])("rejects %s", (url) => {
    expect(checkImageUrl(url).ok).toBe(false);
  });

  it("classifies raw addresses", () => {
    expect(isPrivateIpv4("172.16.0.1")).toBe(true);
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv6("::1")).toBe(true);
    expect(isPrivateIpv6("2606:4700::1111")).toBe(false);
  });
});

describe("input parity helpers", () => {
  it("only allows empty, http or https websites", () => {
    expect(isSafeWebsite("https://example.com")).toBe(true);
    expect(isSafeWebsite("http://example.com")).toBe(true);
    expect(isSafeWebsite("javascript:alert(1)")).toBe(false);
    expect(isSafeWebsite("data:text/html,x")).toBe(false);
  });

  it("only allows https profile images", () => {
    expect(isSafeImageUrl("https://cdn.example.com/a.png")).toBe(true);
    expect(isSafeImageUrl("http://cdn.example.com/a.png")).toBe(false);
    expect(isSafeImageUrl("   ")).toBe(false);
  });
});

describe("published schemas", () => {
  it("gives every tool an oneOf output schema with const actions", () => {
    for (const tool of SURFACE_TOOLS) {
      const branches = (tool.outputSchema as { oneOf?: Record<string, any>[] } | undefined)
        ?.oneOf;
      expect(Array.isArray(branches), tool.name).toBe(true);
      for (const branch of branches) {
        expect(branch.properties?.action?.const, tool.name).toBeTypeOf("string");
        expect(branch.additionalProperties, tool.name).toBe(false);
      }
    }
  });
});
