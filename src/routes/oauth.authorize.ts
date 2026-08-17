import { createFileRoute } from "@tanstack/react-router";

import { beginAuthorization, isOAuthFailure } from "@/lib/room/oauth/server";

/**
 * OAuth 2.1 authorization endpoint.
 *
 * The request is validated and parked server-side; the person is then sent to
 * the in-app consent page. Nothing is granted here, and an unvalidated
 * redirect never happens: a bad client or redirect URI is answered inline.
 */
export const Route = createFileRoute("/oauth/authorize")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const params = Object.fromEntries(url.searchParams.entries());
        const result = await beginAuthorization(params, url.origin, undefined);
        if (isOAuthFailure(result)) {
          return new Response(
            JSON.stringify({ error: result.error, error_description: result.error_description }),
            {
              status: result.status,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            },
          );
        }
        const consent = new URL("/oauth/consent", url.origin);
        consent.searchParams.set("request_id", result.requestId);
        return new Response(null, {
          status: 302,
          headers: { location: consent.toString(), "cache-control": "no-store" },
        });
      },
    },
  },
});
