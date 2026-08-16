import { createFileRoute } from "@tanstack/react-router";

import { openAiAppsChallengeResponse } from "@/lib/room/challenge";

/**
 * GET /.well-known/openai-apps-challenge
 * 404 while OPENAI_APPS_CHALLENGE is unset; otherwise exactly the token.
 */
export const Route = createFileRoute("/.well-known/openai-apps-challenge")({
  server: { handlers: { GET: () => openAiAppsChallengeResponse() } },
});
