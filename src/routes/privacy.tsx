import { createFileRoute } from "@tanstack/react-router";

import { LegalFooter } from "@/components/legal-footer";
import { SupportContact } from "@/components/support-contact";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Crawler Room" },
      {
        name: "description",
        content:
          "How Crawler Room processes pseudonymous room data: no accounts, no profiles, keyed hashes only, 24-hour retention and your controls.",
      },
      { property: "og:title", content: "Privacy Policy — Crawler Room" },
      {
        property: "og:description",
        content: "Data categories, purposes, retention and your controls in Crawler Room.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://crawler.today/privacy" },
    ],
    links: [{ rel: "canonical", href: "https://crawler.today/privacy" }],
  }),
  component: PrivacyPage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border py-8">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This policy describes exactly what Crawler Room processes today. It contains no
          placeholder providers, no promised legal deadlines and no certifications.
        </p>

        <Section title="Who runs Crawler Room">
          <p>
            Crawler Room is published by SEBKLAEY Agency (Sebastian Kläy). Crawler Room is an
            independent product. It is not affiliated with, sponsored by, or endorsed by OpenAI.
          </p>
          <p>
            Contact for privacy questions, access, correction and deletion:{" "}
            <a className="underline" href="/support">
              crawler.today/support
            </a>{" "}
            (category “privacy/data request”), or{" "}
            <a className="underline" href="/data-deletion">
              crawler.today/data-deletion
            </a>{" "}
            for the deletion overview.
          </p>
        </Section>

        <Section title="No accounts and no profiles">
          <p>
            Crawler Room has no sign-in, no registration and no profiles. There is one public
            Universal Room. Every caller is assigned a pseudonym derived on the server; nobody can
            choose it, change it or claim someone else’s. No email address, no password, no name, no
            location and no images are collected at any point.
          </p>
        </Section>

        <Section title="Categories of data we process">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Pseudonymous identifier.</strong> The MCP client (ChatGPT) passes a
              pseudonymous subject with each request. We immediately derive a keyed hash
              (HMAC-SHA256 with a server secret) from it. The raw value is never stored, and the
              hash cannot be reversed into an account, an address or a person.
            </li>
            <li>
              <strong>Room content.</strong> The text messages you send into the Universal Room and
              the pseudonym shown next to them. Room content is public and is removed after at most
              24 hours.
            </li>
            <li>
              <strong>Presence timestamps.</strong> A “last seen” timestamp per pseudonymous hash,
              used only for the aggregate live count of people in the room.
            </li>
            <li>
              <strong>Abuse-protection events.</strong> Rate-limit records containing a pseudonymous
              hash and the action name — never message content.
            </li>
            <li>
              <strong>Reports.</strong> The reporter’s pseudonymous hash, the reported message
              reference, a reason, an optional short note and a tamper-evident hash of the reported
              text.
            </li>
            <li>
              <strong>Support and privacy requests.</strong> Category, subject, message, an optional
              contact you provide voluntarily, and — only if present — a short-lived keyed hash
              derived from trusted request metadata for abuse protection. No raw IP address is
              stored.
            </li>
          </ul>
        </Section>

        <Section title="Purposes">
          <ul className="list-disc space-y-2 pl-5">
            <li>Operating the public Universal Room and its live presence count.</li>
            <li>Preventing spam and abuse (rate limits, spam heuristics, moderation).</li>
            <li>Handling support, abuse reports and privacy requests.</li>
          </ul>
        </Section>

        <Section title="Recipients">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>ChatGPT / OpenAI as the client.</strong> You use Crawler Room through ChatGPT.
              Whatever a tool returns is delivered to the ChatGPT client you are talking to and is
              subject to OpenAI’s own terms and privacy policy. Crawler Room does not separately
              submit your Crawler Room data to OpenAI for the purpose of training. Tool results you
              request are delivered to ChatGPT as the client, and OpenAI handles that data under its
              own terms, privacy policy and applicable product settings.
            </li>
            <li>
              <strong>Hosting and database.</strong> The application runs on the Lovable deployment
              platform (Cloudflare Workers runtime) and stores data in the project’s managed
              Supabase Postgres database.
            </li>
            <li>Other people using Crawler Room see every message you publish in the room.</li>
          </ul>
        </Section>

        <Section title="Retention">
          <p className="mb-3">
            No message stays in Crawler Room longer than 24 hours. The database caps every expiry at
            creation time plus 24 hours, reads never return older content, every write deletes what
            has expired in the room, and a maintenance job sweeps the rest. The rolling limit below
            applies on top of that, immediately when new content is written.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Text messages:</strong> the room keeps only its newest 7 messages, applied on
              every new message, and every message is deleted at the latest 24 hours after it was
              written.
            </li>
            <li>
              <strong>Rate-limit events:</strong> deleted after 2 hours.
            </li>
            <li>
              <strong>Presence and left memberships:</strong> pseudonyms are anonymised 7 days after
              leaving.
            </li>
            <li>
              <strong>Support requests:</strong> message, subject and optional contact are removed
              90 days after submission and the abuse-protection hash after at most 24 hours, when
              the maintenance job runs.
            </li>
            <li>
              <strong>Privacy / deletion requests:</strong> kept while pending; deleted 90 days
              after they are completed or rejected.
            </li>
            <li>
              <strong>Reports:</strong> kept while the moderation case is open and for as long as
              needed to prevent repeat abuse.
            </li>
          </ul>
        </Section>

        <Section title="Hashing and identifiers">
          <p>
            Identity is stored only as HMAC-SHA256 with a server-side secret. Public message
            identifiers handed to ChatGPT are opaque signed references, not database keys. There are
            no access tokens, because Crawler Room requires no sign-in.
          </p>
        </Section>

        <Section title="Logs and security data">
          <p>
            The server writes structured operational log lines containing the tool name, an outcome
            flag, an error code and a duration. Message content, secrets and raw identifiers are not
            written to logs. Hosting providers may keep short-lived infrastructure logs outside our
            control.
          </p>
        </Section>

        <Section title="Your controls">
          <ul className="list-disc space-y-2 pl-5">
            <li>Use Crawler Room without any account, sign-in or personal data.</li>
            <li>Choose what you write — everything in the room is public.</li>
            <li>Report any message for human moderation review directly in the chat.</li>
            <li>
              Request access, correction or deletion at{" "}
              <a className="underline" href="/support">
                /support
              </a>{" "}
              or read the overview at{" "}
              <a className="underline" href="/data-deletion">
                /data-deletion
              </a>
              .
            </li>
          </ul>
          <p>
            Public content you already posted may remain visible to others until it falls out of the
            retention window.
          </p>
        </Section>

        <Section title="Children">
          <p>
            Crawler Room is a general-audience product with no mature or adult experience, and no
            traditional email and password account is required. It is not directed to children under
            13 and must not be used by them. See the{" "}
            <a className="underline" href="/terms">
              Terms
            </a>{" "}
            and the{" "}
            <a className="underline" href="/safety">
              Safety page
            </a>
            .
          </p>
        </Section>

        <Section title="Changes">
          <p>
            When the processing described here changes, this page is updated together with the
            release that changes it.
          </p>
        </Section>
      </main>
      <div className="mx-auto max-w-5xl px-6 pb-8">
        <SupportContact />
      </div>
      <LegalFooter note="Privacy" />
    </div>
  );
}
