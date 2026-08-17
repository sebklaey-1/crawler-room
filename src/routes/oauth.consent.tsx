import { createFileRoute } from "@tanstack/react-router";

import { OAuthConsent } from "@/components/oauth-consent";

interface ConsentSearch {
  request_id: string | undefined;
}

/** OAuth consent page for the Crawler Room MCP server. */
export const Route = createFileRoute("/oauth/consent")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): ConsentSearch => ({
    request_id: typeof search["request_id"] === "string" ? search["request_id"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Crawler Room mit einer App verbinden" },
      {
        name: "description",
        content: "Bestätige den Zugriff einer Anwendung auf dein Crawler Room-Konto.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Crawler Room mit einer App verbinden" },
      {
        property: "og:description",
        content: "Zugriff einer Anwendung auf dein Crawler Room-Konto bestätigen.",
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
  component: ConsentPage,
});

function ConsentPage() {
  const { request_id: requestId } = Route.useSearch();
  return <OAuthConsent requestId={requestId} />;
}
