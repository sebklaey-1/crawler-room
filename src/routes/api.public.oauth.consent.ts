import { createFileRoute } from "@tanstack/react-router";

import { resolveAnchoredSubject } from "@/lib/room/anchor";
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

function json(body: unknown, status = 200, setCookie?: string | null): Response {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
    ...CORS,
  });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(JSON.stringify(body), { status, headers });
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

        // The durable anchor wins over the ephemeral browser session, so a new
        // anonymous session never forks a second identity for the same person.
        const sessionSubject = await webSessionHash(sessionToken(request));
        const anchored = await resolveAnchoredSubject(
          request.headers.get("cookie"),
          sessionSubject,
        );
        if (!anchored) {
          return json(
            { error: "login_required", error_description: "Die Verbindung ist abgelaufen." },
            401,
          );
        }

        try {
          const result = await decideAuthorization(
            body.request_id,
            decision,
            anchored.subjectHash,
          );
          if (isOAuthFailure(result)) {
            return json(
              { error: result.error, error_description: result.error_description },
              result.status,
              anchored.setCookie,
            );
          }
          return json(result, 200, anchored.setCookie);
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
