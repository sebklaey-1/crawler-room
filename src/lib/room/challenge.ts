/**
 * Domain verification for the OpenAI apps directory.
 *
 * Returns the configured challenge token as plain text; 404 while unset.
 */
export function openAiAppsChallengeResponse(): Response {
  const token = process.env["OPENAI_APPS_CHALLENGE"]?.trim();
  if (!token) return new Response("Not found", { status: 404 });
  return new Response(token, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
