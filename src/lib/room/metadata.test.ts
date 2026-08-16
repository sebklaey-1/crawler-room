import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  PRODUCTION_MCP_RESOURCE,
  challengeHeader,
  protectedResourceMetadata,
  resourceMetadataUrl,
} from "./auth";

const CANONICAL_METADATA_URL =
  "https://crawler.today/.well-known/oauth-protected-resource/api/public/mcp";

describe("RFC 9728 path-specific metadata", () => {
  it("inserts the well-known suffix between host and resource path", () => {
    expect(resourceMetadataUrl()).toBe(CANONICAL_METADATA_URL);
  });

  it("advertises exactly that URL in every challenge", () => {
    expect(challengeHeader()).toBe(`Bearer resource_metadata="${CANONICAL_METADATA_URL}"`);
    expect(challengeHeader(undefined, "invalid_token")).toContain(
      `resource_metadata="${CANONICAL_METADATA_URL}"`,
    );
  });

  it("keeps the resource identifier untouched", () => {
    process.env["SUPABASE_URL"] ??= "https://example.supabase.co";
    expect(protectedResourceMetadata().resource).toBe(PRODUCTION_MCP_RESOURCE);
    expect(new URL(CANONICAL_METADATA_URL).origin).toBe(
      new URL(PRODUCTION_MCP_RESOURCE).origin,
    );
  });

  it("documents the product page, not the generic root", () => {
    expect(protectedResourceMetadata().resource_documentation).toBe(
      "https://crawler.today/crawler-room",
    );
  });

  it("serves the identical document on both routes", () => {
    const canonical = "src/routes/[.]well-known.oauth-protected-resource.api.public.mcp.ts";
    const alias = "src/routes/[.]well-known.oauth-protected-resource.ts";
    expect(existsSync(canonical)).toBe(true);
    expect(existsSync(alias)).toBe(true);
    for (const file of [canonical, alias]) {
      const text = readFileSync(file, "utf8");
      expect(text).toContain("metadataResponse");
      expect(text).toContain("metadataPreflight");
    }
    expect(readFileSync(canonical, "utf8")).toContain(
      "/.well-known/oauth-protected-resource/api/public/mcp",
    );
  });
});
