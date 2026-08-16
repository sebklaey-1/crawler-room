import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
};

/**
 * Convenience alias: some MCP clients look for the authorization server
 * metadata on the resource origin. The authorization server is the project's
 * own auth service, so the document is served from there.
 */
export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: {
    handlers: {
      GET: async () => {
        const issuer = process.env["SUPABASE_URL"];
        if (!issuer) return new Response("Not configured", { status: 404, headers: CORS });
        const upstream = await fetch(`${issuer}/.well-known/oauth-authorization-server`);
        const body = await upstream.text();
        return new Response(body, {
          status: upstream.status,
          headers: { "content-type": "application/json", "cache-control": "public, max-age=300", ...CORS },
        });
      },
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
    },
  },
});
