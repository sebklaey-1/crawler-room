import { createFileRoute } from "@tanstack/react-router";

import { handleMcpRequest } from "@/lib/room/mcp";

/**
 * DEPRECATED compatibility endpoint for the Crawler Room MCP server.
 *
 * The canonical resource is `https://crawler.today/mcp` (see
 * `src/routes/mcp.ts`). This legacy path stays functional for already
 * configured clients and shares the exact same `handleMcpRequest`
 * implementation — no copy/paste drift, same transport semantics, same seven
 * tools. It has NO resource identity of its own: `serverInfo`, protected
 * resource metadata and every `WWW-Authenticate` challenge emitted here name
 * the canonical `/mcp` resource and its canonical PRM URL.
 *
 * Not to be used for the OpenAI submission. No redirect is issued, because a
 * 30x on a Streamable HTTP POST breaks MCP clients.
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
