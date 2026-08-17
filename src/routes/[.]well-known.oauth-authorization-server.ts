import { createFileRoute } from "@tanstack/react-router";

import { authorizationServerMetadata } from "@/lib/room/oauth/server";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

/**
 * RFC 8414 — authorization server metadata of Crawler Room itself.
 * Crawler Room is both the protected resource and the authorization server;
 * no external identity provider is involved.
 */
export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(
          JSON.stringify(authorizationServerMetadata(new URL(request.url).origin)),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "cache-control": "public, max-age=300",
              ...CORS,
            },
          },
        ),
      OPTIONS: () => new Response(null, { status: 204, headers: { ...CORS } }),
    },
  },
});
