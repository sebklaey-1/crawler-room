import { createFileRoute } from "@tanstack/react-router";

import { toRoomError } from "@/lib/room/errors";
import { consentDetails, decideAuthorization, isOAuthFailure } from "@/lib/room/oauth/server";
import { webSessionHash } from "@/lib/room/websession";

/**
 * Consent backend for the Crawler Room authorization server.
 *
 * The page is public (`/api/public/*`), so every request is authorised here:
 * the caller must present a valid browser session token, from which only the
 * keyed pseudonymous digest is derived. The raw account id never enters the
 * OAuth tables, and the digest — not an account — becomes the token subject.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });
}

function sessionToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

export const Route = createFileRoute("/api/public/oauth/consent")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: { ...CORS } }),

      GET: async ({ request }) => {
        const requestId = new URL(request.url).searchParams.get("request_id");
        try {
          const details = await consentDetails(requestId);
          if (isOAuthFailure(details)) {
            return json(
              { error: details.error, error_description: details.error_description },
              details.status,
            );
          }
          return json(details);
        } catch (error) {
          return json(
            { error: "server_error", error_description: toRoomError(error).message },
            500,
          );
        }
      },

      POST: async ({ request }) => {
        let body: { request_id?: unknown; decision?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "invalid_request", error_description: "Body is not JSON." }, 400);
        }
        const decision = body.decision === "approve" ? "approve" : "deny";

        const subject = await webSessionHash(sessionToken(request));
        if (!subject) {
          return json(
            { error: "login_required", error_description: "Die Verbindung ist abgelaufen." },
            401,
          );
        }

        try {
          const result = await decideAuthorization(body.request_id, decision, subject);
          if (isOAuthFailure(result)) {
            return json(
              { error: result.error, error_description: result.error_description },
              result.status,
            );
          }
          return json(result);
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
