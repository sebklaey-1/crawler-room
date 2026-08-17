import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  PRODUCTION_MCP_RESOURCE,
  challengeHeader,
  protectedResourceMetadata,
  resourceMetadataUrl,
} from "./auth";

const CANONICAL_METADATA_URL =
  "https://crawler.today/.well-known/oauth-protected-resource/mcp";

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
    expect(new URL(CANONICAL_METADATA_URL).origin).toBe(new URL(PRODUCTION_MCP_RESOURCE).origin);
  });

  it("documents the product page, not the generic root", () => {
    expect(protectedResourceMetadata().resource_documentation).toBe(
      "https://crawler.today/crawler-room",
    );
  });

  it("serves the identical document on the canonical route and both aliases", () => {
    const canonical = "src/routes/[.]well-known.oauth-protected-resource.mcp.ts";
    const rootAlias = "src/routes/[.]well-known.oauth-protected-resource.ts";
    const legacyAlias = "src/routes/[.]well-known.oauth-protected-resource.api.public.mcp.ts";
    for (const file of [canonical, rootAlias, legacyAlias]) {
      expect(existsSync(file)).toBe(true);
      const text = readFileSync(file, "utf8");
      expect(text).toContain("metadataResponse");
      expect(text).toContain("metadataPreflight");
    }
    expect(readFileSync(canonical, "utf8")).toContain("/.well-known/oauth-protected-resource/mcp");
    expect(readFileSync(legacyAlias, "utf8")).toContain("DEPRECATED");
  });

  it("exposes the canonical MCP route and keeps the deprecated one working", () => {
    const canonicalRoute = readFileSync("src/routes/mcp.ts", "utf8");
    const legacyRoute = readFileSync("src/routes/api.public.mcp.ts", "utf8");
    expect(canonicalRoute).toContain('createFileRoute("/mcp")');
    expect(canonicalRoute).toContain("handleMcpRequest");
    expect(legacyRoute).toContain('createFileRoute("/api/public/mcp")');
    // Shared handler: no copy/paste drift between the two endpoints.
    expect(legacyRoute).toContain("handleMcpRequest");
    expect(legacyRoute).toContain("DEPRECATED");
  });
});
