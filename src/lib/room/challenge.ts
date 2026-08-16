/**
 * OpenAI domain verification token endpoint logic.
 * The token is never committed: it comes exclusively from OPENAI_APPS_CHALLENGE.
 */
const HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export function openAiAppsChallengeResponse(): Response {
  const token = (process.env["OPENAI_APPS_CHALLENGE"] ?? "").trim();
  if (!token) return new Response("Not Found", { status: 404, headers: HEADERS });
  return new Response(token, { status: 200, headers: HEADERS });
}
