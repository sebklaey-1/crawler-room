import { createFileRoute } from "@tanstack/react-router";

/**
 * OpenAI domain verification.
 *
 * The token is never committed: it comes exclusively from the
 * `OPENAI_APPS_CHALLENGE` environment variable. Unset -> 404.
 * Set -> 200 text/plain with exactly the token as the body.
 */
function challengeResponse(): Response {
  const token = (process.env["OPENAI_APPS_CHALLENGE"] ?? "").trim();
  if (!token) {
    return new Response("Not Found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  return new Response(token, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export const Route = createFileRoute("/.well-known/openai-apps-challenge")({
  server: { handlers: { GET: () => challengeResponse() } },
});

export { challengeResponse as __challengeResponse };
