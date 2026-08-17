import { createFileRoute, redirect } from "@tanstack/react-router";

interface ConsentSearch {
  request_id: string | undefined;
}

/**
 * Legacy consent path. The authorization server points at `/oauth/consent`;
 * this route only forwards old links there and renders nothing itself.
 */
export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): ConsentSearch => ({
    request_id: typeof search["request_id"] === "string" ? search["request_id"] : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/oauth/consent",
      search: { request_id: search.request_id },
      replace: true,
    });
  },
  component: () => null,
});
