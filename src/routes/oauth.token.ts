import { createFileRoute } from "@tanstack/react-router";

import { toRoomError } from "@/lib/room/errors";
import { exchangeToken, isOAuthFailure } from "@/lib/room/oauth/server";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
} as const;

const MAX_BODY_BYTES = 8 * 1024;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      pragma: "no-cache",
      ...CORS,
    },
  });
}

/**
 * OAuth 2.1 token endpoint: `authorization_code` (PKCE S256) and rotating
 * `refresh_token`. Tokens are never cached, logged or echoed anywhere else.
 */
export const Route = createFileRoute("/oauth/token")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: { ...CORS } }),
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) {
          return json({ error: "invalid_request", error_description: "Body too large." }, 413);
        }
        const form: Record<string, string> = {};
        for (const [key, value] of new URLSearchParams(raw).entries()) form[key] = value;

        // Some clients send HTTP Basic client authentication.
        const authorization = request.headers.get("authorization") ?? "";
        const basic = /^Basic\s+(.+)$/i.exec(authorization.trim());
        if (basic?.[1]) {
          try {
            const decoded = atob(basic[1]);
            const separator = decoded.indexOf(":");
            if (separator > 0) {
              form["client_id"] = decodeURIComponent(decoded.slice(0, separator));
              form["client_secret"] = decodeURIComponent(decoded.slice(separator + 1));
            }
          } catch {
            return json({ error: "invalid_client", error_description: "Malformed header." }, 401);
          }
        }

        try {
          const result = await exchangeToken(form, new URL(request.url).origin);
          if (isOAuthFailure(result)) {
            return json(
              { error: result.error, error_description: result.error_description },
              result.status,
            );
          }
          return json(result, 200);
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
