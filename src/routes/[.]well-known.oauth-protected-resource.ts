import { createFileRoute } from "@tanstack/react-router";

import { metadataPreflight, metadataResponse } from "@/lib/room/resource-metadata";

/**
 * RFC 9728 compatibility alias. The canonical, challenge-advertised location
 * is `/.well-known/oauth-protected-resource/api/public/mcp`; this root path
 * serves the identical document for clients that only try the bare form.
 */
export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: ({ request }) => metadataResponse(request),
      OPTIONS: () => metadataPreflight(),
    },
  },
});
