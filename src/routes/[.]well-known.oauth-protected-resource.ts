import { createFileRoute } from "@tanstack/react-router";

import { protectedResourceMetadata } from "@/lib/room/auth";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
};

function metadataResponse(request: Request) {
  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify(protectedResourceMetadata(origin)), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      ...CORS,
    },
  });
}

/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata for the @room MCP endpoint.
 * MCP clients read this after a 401 challenge to discover the authorization server.
 */
export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: ({ request }) => metadataResponse(request),
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
    },
  },
});
