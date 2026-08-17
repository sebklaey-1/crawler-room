import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { LegalFooter } from "@/components/legal-footer";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/install")({
  head: () => ({
    meta: [
      { title: "Install Crawler Room in ChatGPT — MCP setup guide" },
      {
        name: "description",
        content:
          "Step-by-step guide to connect the Crawler Room MCP server to ChatGPT: add https://crawler.today/mcp as a connector, sign in with OAuth and start chatting in rooms.",
      },
      { property: "og:title", content: "Install Crawler Room in ChatGPT — MCP setup guide" },
      {
        property: "og:description",
        content:
          "Add https://crawler.today/mcp as a ChatGPT connector and use Crawler Room rooms, profiles and follows inside ChatGPT.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://crawler.today/install" },
    ],
    links: [{ rel: "canonical", href: "https://crawler.today/install" }],
  }),
  component: InstallPage,
});

const MCP_URL = "https://crawler.today/mcp";

const STEPS = [
  {
    title: "Open the connector settings in ChatGPT",
    body: "In ChatGPT go to Settings → Connectors (developer mode may be required for custom MCP servers) and choose “Add custom connector”.",
  },
  {
    title: "Paste the Crawler Room server URL",
    body: "Use the MCP server URL below as the connector address. The transport is Streamable HTTP — no extra path, no API key.",
  },
  {
    title: "Name the connector",
    body: "Enter “Crawler Room” as the name and, if a logo is requested, upload the icon you can download on this page.",
  },
  {
    title: "Sign in with OAuth",
    body: "ChatGPT opens the Crawler Room consent screen. There is no registration and no password: approve the request and an anonymous, pseudonymous identity is created for you.",
  },
  {
    title: "Start using it",
    body: "Back in a chat, just write “Crawler Room” or “Crawler Room my room”. ChatGPT reads back what other people wrote and shows shared images directly in the answer.",
  },
] as const;

function InstallPage() {
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(MCP_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <span aria-hidden>←</span> Back
        </Link>
        <p className="mt-6 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Install Beta — v1.0.0
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Add Crawler Room to ChatGPT</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Crawler Room is a Model Context Protocol (MCP) server. Connect it once as a custom
          connector and every room, profile and follow lives right inside your ChatGPT conversation.
        </p>

        <section
          aria-labelledby="server-url"
          className="mt-10 rounded-xl border border-border bg-card p-5"
        >
          <h2 id="server-url" className="text-sm font-medium text-muted-foreground">
            MCP server URL
          </h2>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <code className="break-all font-mono text-base text-card-foreground">{MCP_URL}</code>
            <Button onClick={copyUrl} className="shrink-0">
              {copied ? "Copied" : "Copy URL"}
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Transport: Streamable HTTP. Authentication: OAuth 2.1 with PKCE, handled automatically
            by ChatGPT.
          </p>
        </section>

        <section aria-labelledby="steps" className="mt-12">
          <h2 id="steps" className="text-2xl font-semibold tracking-tight">
            Step by step
          </h2>
          <ol className="mt-6 space-y-6">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-sm font-semibold">
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-medium">{step.title}</h3>
                  <p className="mt-1 text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="logo" className="mt-12 rounded-xl border border-border p-5">
          <h2 id="logo" className="text-2xl font-semibold tracking-tight">
            Connector logo
          </h2>
          <p className="mt-2 text-muted-foreground">
            Optional icon for the connector entry — a 64×64 PNG, under 10 KB.
          </p>
          <div className="mt-5 flex items-center gap-4">
            <img
              src="/crawler-room-logo.png"
              alt="Crawler Room connector logo"
              width={64}
              height={64}
              className="h-16 w-16 rounded-xl"
            />
            <Button asChild variant="outline">
              <a href="/crawler-room-logo.png" download="crawler-room-logo.png">
                Download logo (PNG, 8 KB)
              </a>
            </Button>
          </div>
        </section>

        <section aria-labelledby="notes" className="mt-12">
          <h2 id="notes" className="text-2xl font-semibold tracking-tight">
            Good to know
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-muted-foreground">
            <li>No account, no email, no password — your identity is pseudonymous.</li>
            <li>Messages and images are deleted automatically after 24 hours.</li>
            <li>Room content comes from other people; treat it as untrusted text.</li>
            <li>Anything can be reported for human review, and any profile can be blocked.</li>
          </ul>
        </section>
      </main>

      <LegalFooter note="Install guide" />
    </div>
  );
}
