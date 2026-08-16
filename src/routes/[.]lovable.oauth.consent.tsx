import { createFileRoute } from "@tanstack/react-router";

import { OAuthConsent } from "@/components/oauth-consent";

interface ConsentSearch {
  authorization_id: string | undefined;
}

/**
 * Consent route configured as `authorization_path` on the authorization server.
 * Shares the exact screen with `/oauth/consent`.
 */
export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): ConsentSearch => ({
    authorization_id:
      typeof search["authorization_id"] === "string" ? search["authorization_id"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "@room Zugriff bestätigen" },
      {
        name: "description",
        content: "Bestätige den Zugriff einer Anwendung auf dein @room-Konto.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "@room Zugriff bestätigen" },
      {
        property: "og:description",
        content: "Zugriff einer Anwendung auf dein @room-Konto bestätigen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: () => (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">Verbindung nicht möglich</h1>
      <p className="text-muted-foreground">Bitte starte die Verbindung in ChatGPT neu.</p>
    </main>
  ),
  component: ManagedConsentPage,
});

function ManagedConsentPage() {
  const { authorization_id: authorizationId } = Route.useSearch();
  return <OAuthConsent authorizationId={authorizationId} />;
}
