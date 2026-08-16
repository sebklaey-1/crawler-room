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
          "How Crawler Room processes pseudonymous room data: categories, purposes, recipients, retention, hashing, OAuth and your controls.",
      },
      { property: "og:title", content: "Privacy Policy — Crawler Room" },
      {
        property: "og:description",
        content: "Data categories, purposes, retention and your controls in Crawler Room.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
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
          This policy describes exactly what Crawler Room
          processes today. It contains no placeholder providers, no promised legal deadlines and no
          certifications.
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
            for a verified deletion request.
          </p>
        </Section>

        <Section title="Categories of data we process">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Pseudonymous account identifier.</strong> When you sign in through the OAuth
              flow, we verify your access token and derive a keyed hash (HMAC-SHA256 with a server
              secret) from your account id. The raw account id and the raw access token are never
              stored. There is no automatic linking of a legacy ChatGPT <code>openai/subject</code>{" "}
              identity to an account.
            </li>
            <li>
              <strong>Profile data you choose to publish.</strong> Handle, display name, bio,
              location, link, avatar and banner image, room name and description, privacy toggles.
              Anything you publish here is public.
            </li>
            <li>
              <strong>Room content.</strong> Text messages and images you send into the Universal
              Room, personal public rooms and community rooms, plus the alias shown next to them.
            </li>
            <li>
              <strong>Social signals.</strong> Follows, likes, blocks, notifications and presence
              timestamps (“last seen”) used to show who is currently in a room.
            </li>
            <li>
              <strong>Community and organisation data.</strong> Community name, slug, description,
              website, membership and role.
            </li>
            <li>
              <strong>Counting-only analytics.</strong> Aggregate event counters per room (for
              example views, follows, likes) with the room owner’s pseudonymous hash. No visitor
              identity is shown to anyone.
            </li>
            <li>
              <strong>Abuse-protection events.</strong> Rate-limit records containing a pseudonymous
              hash and the action name — never message content.
            </li>
            <li>
              <strong>Support and privacy requests.</strong> Category, subject, message, an optional
              contact you provide voluntarily, an optional public handle you reference, and — only
              if present — a short-lived keyed hash derived from trusted request metadata for abuse
              protection. No raw IP address is stored.
            </li>
          </ul>
        </Section>

        <Section title="Purposes">
          <ul className="list-disc space-y-2 pl-5">
            <li>Operating the rooms, profiles, follows, likes, communities and analytics.</li>
            <li>Verifying that a write or management action really belongs to your account.</li>
            <li>Preventing spam and abuse (rate limits, image safety review, blocks).</li>
            <li>Handling support, abuse reports and privacy requests.</li>
          </ul>
        </Section>

        <Section title="Recipients">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>ChatGPT / OpenAI as the client.</strong> You use Crawler Room through ChatGPT.
              Whatever a tool returns is delivered to the ChatGPT client you are talking to and is
              subject to OpenAI’s own terms and privacy policy. We do not send data to OpenAI for
              training.
            </li>
            <li>
              <strong>Hosting and database.</strong> The application runs on the Lovable deployment
              platform (Cloudflare Workers runtime) and stores data in the project’s managed
              Supabase Postgres database and its object storage bucket for images.
            </li>
            <li>
              Other people using Crawler Room see everything you publish publicly (messages, images,
              profile, community posts).
            </li>
          </ul>
        </Section>

        <Section title="Retention">
          <p className="mb-3">
            No message and no image stays in Crawler Room longer than 24 hours, in every room type.
            The database caps every expiry at creation time plus 24 hours, reads never return older
            content, every write path deletes what has expired in that room, and a maintenance job
            sweeps the rest including the stored files. The rolling limits below apply on top of
            that, immediately when new content is written.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Text messages:</strong> a room keeps only its newest 7 messages, applied on
              every new message, and every message is deleted at the latest 24 hours after it was
              written.
            </li>
            <li>
              <strong>Images:</strong> a room keeps only its newest 3 approved images and every
              image is deleted at the latest 24 hours after upload, together with its file in
              storage. Rejected, failed or never-completed uploads are purged, and the underlying
              files are removed from storage.
            </li>
            <li>
              <strong>Rate-limit events:</strong> deleted after 2 hours.
            </li>
            <li>
              <strong>Notifications:</strong> deleted after 30 days.
            </li>
            <li>
              <strong>Left memberships:</strong> alias and pseudonym are anonymised 7 days after
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
              <strong>Analytics counters:</strong> aggregate rows are kept while the room exists.
            </li>
          </ul>
        </Section>

        <Section title="Hashing and tokens">
          <p>
            Account identity is stored only as HMAC-SHA256 with a server-side secret. Public
            message, image and room identifiers handed to ChatGPT are opaque signed references, not
            database keys. Access tokens are verified against the authorization server and are never
            logged, stored or returned in a tool result.
          </p>
        </Section>

        <Section title="Logs and security data">
          <p>
            The server writes structured operational log lines containing the tool name, an outcome
            flag, an error code and a duration. Message content, tokens, secrets and raw identifiers
            are not written to logs. Hosting providers may keep short-lived infrastructure logs
            outside our control.
          </p>
        </Section>

        <Section title="Your controls">
          <ul className="list-disc space-y-2 pl-5">
            <li>Read publicly without signing in; only write and management actions need OAuth.</li>
            <li>Edit or clear your profile fields, images, bio, link and privacy toggles.</li>
            <li>Hide online status, follower counts or likes on your profile.</li>
            <li>Block a profile so its content no longer reaches you.</li>
            <li>
              Request access, correction or deletion at{" "}
              <a className="underline" href="/support">
                /support
              </a>{" "}
              or, verified through your signed-in session, at{" "}
              <a className="underline" href="/data-deletion">
                /data-deletion
              </a>
              .
            </li>
          </ul>
          <p>
            Public content you already posted may remain visible to others until it falls out of the
            room retention window or is removed as part of a deletion request.
          </p>
        </Section>

        <Section title="Children">
          <p>
            Crawler Room is not directed to children under 13 and must not be used by them. See the{" "}
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
