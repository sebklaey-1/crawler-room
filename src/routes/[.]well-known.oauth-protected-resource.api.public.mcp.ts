import { createFileRoute } from "@tanstack/react-router";

import { metadataPreflight, metadataResponse } from "@/lib/room/resource-metadata";

/**
 * RFC 9728 — DEPRECATED compatibility alias for the old
 * `/api/public/mcp` endpoint. It serves the identical document as the
 * canonical `/.well-known/oauth-protected-resource/mcp` route and therefore
 * advertises `resource = https://crawler.today/mcp`. Challenges never point
 * here.
 */
export const Route = createFileRoute("/.well-known/oauth-protected-resource/api/public/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => metadataResponse(request),
      OPTIONS: () => metadataPreflight(),
    },
  },
});
