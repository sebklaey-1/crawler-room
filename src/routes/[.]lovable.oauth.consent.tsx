import { createFileRoute, redirect } from "@tanstack/react-router";

interface ConsentSearch {
  authorization_id: string | undefined;
}

/**
 * Legacy consent path. The authorization server points at `/oauth/consent`;
 * this route only forwards old links there and renders nothing itself.
 */
export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): ConsentSearch => ({
    authorization_id:
      typeof search["authorization_id"] === "string" ? search["authorization_id"] : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/oauth/consent",
      search: search.authorization_id ? { authorization_id: search.authorization_id } : {},
      replace: true,
    });
  },
  component: () => null,
});
