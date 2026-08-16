import { createFileRoute } from "@tanstack/react-router";

import { metadataPreflight, metadataResponse } from "@/lib/room/resource-metadata";

/**
 * RFC 9728 — canonical, path-specific protected-resource metadata for
 * `https://crawler.today/api/public/mcp`. Every bearer challenge points here.
 */
export const Route = createFileRoute("/.well-known/oauth-protected-resource/api/public/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => metadataResponse(request),
      OPTIONS: () => metadataPreflight(),
    },
  },
});
