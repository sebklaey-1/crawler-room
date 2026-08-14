import { createFileRoute } from "@tanstack/react-router";

import { handleMcpRequest } from "@/lib/room/mcp";

/**
 * @room MCP endpoint (Streamable HTTP).
 * Public by design: authentication is not used; the caller is identified
 * pseudonymously through MCP `_meta` (`openai/subject`).
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
