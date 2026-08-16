import { createFileRoute } from "@tanstack/react-router";

import { handleMcpRequest } from "@/lib/room/mcp";

/**
 * Crawler Room MCP endpoint (Streamable HTTP).
 * Mixed access: side-effect-free public reads are `noauth`, while every
 * personal, writing or administrative action requires a validated OAuth 2.1
 * bearer token. MCP `_meta` (`openai/subject`) only seeds the pseudonymous
 * identity — it is never a proof of authorization or of ownership.
 */
export const Route = createFileRoute("/api/public/mcp")({
  server: {
    handlers: {
      POST: ({ request }) => handleMcpRequest(request),
      GET: ({ request }) => handleMcpRequest(request),
      DELETE: ({ request }) => handleMcpRequest(request),
      OPTIONS: ({ request }) => handleMcpRequest(request),
    },
  },
});
