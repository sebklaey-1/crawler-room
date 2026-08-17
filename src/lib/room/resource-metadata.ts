/**
 * Shared RFC 9728 response for all three metadata routes.
 *
 * The canonical (challenge-advertised) location is the path-specific
 * `/.well-known/oauth-protected-resource/mcp`. The bare root path and the
 * DEPRECATED `/.well-known/oauth-protected-resource/api/public/mcp` variant
 * stay available as compatibility aliases and serve the *identical* document,
 * so any client still discovers the same canonical `resource` value.
 */

import { protectedResourceMetadata } from "./auth";

export const METADATA_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
} as const;

export function metadataResponse(request: Request): Response {
  // The canonical resource comes from configuration (ROOM_MCP_RESOURCE), never
  // from a spoofable Host header. Only the test harness derives it from origin.
  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify(protectedResourceMetadata(origin)), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      ...METADATA_CORS,
    },
  });
}

export function metadataPreflight(): Response {
  return new Response(null, { status: 204, headers: { ...METADATA_CORS } });
}
