import { createFileRoute } from "@tanstack/react-router";

import { LegalFooter } from "@/components/legal-footer";
import { SupportContact } from "@/components/support-contact";

export const Route = createFileRoute("/data-deletion")({
  head: () => ({
    meta: [
      { title: "Delete your Crawler Room data" },
      {
        name: "description",
        content:
          "How Crawler Room data deletion works: messages expire automatically within 24 hours, and there is no account, profile or stored personal identifier to delete.",
      },
      { property: "og:title", content: "Delete your Crawler Room data" },
      {
        property: "og:description",
        content:
          "Crawler Room has no accounts and no profiles. Messages disappear automatically; anything else is handled through support.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://crawler.today/data-deletion" },
    ],
    links: [{ rel: "canonical", href: "https://crawler.today/data-deletion" }],
  }),
  component: DataDeletionPage,
});

function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold tracking-tight">Delete your Crawler Room data</h1>

        <section className="mt-6 space-y-3 text-sm text-muted-foreground">
          <p>
            Crawler Room is a general-audience service with no accounts, no sign-in and no profiles.
            There is nothing to log into and nothing to delete from a profile, because none is
            created. You are identified only by a pseudonym that the service derives on the fly.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Messages in the Universal Room are deleted automatically within 24 hours.</li>
            <li>
              Only the newest messages of the room stay readable; older ones are removed
              continuously.
            </li>
            <li>
              No email address, no password, no name, no location and no images are stored at any
              point.
            </li>
          </ul>
          <p>
            <strong>What stays:</strong> aggregate counters that contain no identity, plus
            moderation and abuse records we must keep to prevent repeat abuse. Those records hold a
            one-way keyed hash, never a readable identifier.
          </p>
          <p>
            Because there is no account, an early deletion of a specific message cannot be verified
            automatically. If a message of yours needs to be removed before it expires, write to
            support and describe it — see the{" "}
            <a className="underline" href="/privacy">
              Privacy Policy
            </a>{" "}
            for the full picture. Requests are handled manually and there is no promised processing
            deadline.
          </p>
          <p>
            Users under 13 are not permitted to use Crawler Room. If you believe a child is using
            the service, contact support and we will remove the content.
          </p>
        </section>

        <section className="mt-10 rounded-lg border border-border p-6">
          <h2 className="text-lg font-semibold">Contact support</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Send us the room, the approximate time and a short description of the message. Do not
            include personal data in your request.
          </p>
          <div className="mt-4">
            <SupportContact />
          </div>
        </section>
      </main>

      <LegalFooter note="Data deletion" />
    </div>
  );
}
