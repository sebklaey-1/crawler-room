import { createFileRoute } from "@tanstack/react-router";

import { toRoomError } from "@/lib/room/errors";
import { isOAuthFailure, registerClient } from "@/lib/room/oauth/server";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

const MAX_BODY_BYTES = 16 * 1024;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });
}

/**
 * RFC 7591 — dynamic client registration.
 *
 * Open registration is intentional (MCP clients self-register), but a
 * registration grants nothing: every token still requires a human consent
 * decision, PKCE and an exact redirect-URI match.
 */
export const Route = createFileRoute("/oauth/register")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: { ...CORS } }),
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) {
          return json({ error: "invalid_request", error_description: "Body too large." }, 413);
        }
        let body: unknown;
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          return json({ error: "invalid_request", error_description: "Body is not JSON." }, 400);
        }
        try {
          const result = await registerClient(body);
          if (isOAuthFailure(result)) {
            return json(
              { error: result.error, error_description: result.error_description },
              result.status,
            );
          }
          return json(result, 201);
        } catch (error) {
          return json(
            { error: "server_error", error_description: toRoomError(error).message },
            500,
          );
        }
      },
    },
  },
});
