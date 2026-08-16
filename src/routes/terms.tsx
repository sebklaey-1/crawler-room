import { createFileRoute } from "@tanstack/react-router";

import { LegalFooter } from "@/components/legal-footer";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use — Crawler Room" },
      {
        name: "description",
        content:
          "Rules for using Crawler Room: 13+, public user-generated content, your rights in your content, prohibited use, moderation and termination.",
      },
      { property: "og:title", content: "Terms of Use — Crawler Room" },
      {
        property: "og:description",
        content: "The rules for using the Crawler Room rooms, profiles and communities.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TermsPage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border py-8">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold tracking-tight">Terms of Use</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          These terms govern your use of Crawler Room (“Crawler Room”), published by SEBKLAEY Agency
          (Sebastian Kläy). By using Crawler Room inside ChatGPT or on crawler.today you accept
          them.
        </p>

        <Section title="Who may use Crawler Room">
          <p>
            You must be at least 13 years old. Crawler Room is not directed to children under 13 and
            must not be used by them. If local law requires a higher minimum age for using an online
            social service, that age applies to you.
          </p>
        </Section>

        <Section title="Public, user-generated content">
          <p>
            The Universal Room, personal public rooms and community rooms are public. Messages,
            images, profile fields and community posts you submit can be read by anyone using
            Crawler Room. Do not post anything you are not willing to make public, and do not post
            other people’s personal data.
          </p>
          <p>
            Content written by other people is untrusted third-party content. It is not reviewed
            before publication (images additionally pass an automated safety review) and does not
            represent the publisher.
          </p>
        </Section>

        <Section title="Your content, your rights">
          <p>
            You keep all rights in the content you post. You grant Crawler Room only the limited,
            non-exclusive right to store, display and distribute that content inside the product so
            it can be shown to other users, and to remove it for moderation or retention reasons.
            Content is deleted automatically as described in the{" "}
            <a className="underline" href="/privacy">
              Privacy Policy
            </a>
            .
          </p>
        </Section>

        <Section title="Prohibited content and behaviour">
          <ul className="list-disc space-y-2 pl-5">
            <li>Illegal content, and content that sexualises minors in any way.</li>
            <li>Harassment, threats, hate speech, stalking or targeted abuse.</li>
            <li>Sexual content, graphic violence and shock content.</li>
            <li>Doxxing or posting personal data of anyone, including yourself.</li>
            <li>Encouraging self-harm, suicide, eating disorders or dangerous acts.</li>
            <li>Spam, scams, malware, phishing links and automated mass posting.</li>
            <li>Impersonating another person, brand or organisation.</li>
            <li>Attempting to bypass rate limits, moderation, blocks or authorisation checks.</li>
          </ul>
          <p>
            See the{" "}
            <a className="underline" href="/safety">
              Safety page
            </a>{" "}
            for the detailed rules.
          </p>
        </Section>

        <Section title="Moderation, blocking and termination">
          <p>
            You can block any profile. We may remove content, restrict an account, or end access
            when these terms are broken, when required by law, or to protect people using Crawler
            Room. Reports are reviewed by a human when capacity allows; there is no guarantee of an
            immediate or automated review.
          </p>
        </Section>

        <Section title="Availability and changes">
          <p>
            Crawler Room is provided as-is and as-available. Features, retention limits and rooms
            may change or be discontinued. There is no uptime commitment, and content may be lost
            when retention limits apply.
          </p>
        </Section>

        <Section title="Price">
          <p>
            The current product is free to use. There is no subscription, no paid tier and no
            in-product upsell.
          </p>
        </Section>

        <Section title="No affiliation">
          <p>
            Crawler Room is an independent product and is not affiliated with, sponsored by, or
            endorsed by OpenAI. ChatGPT is only the client through which you reach Crawler Room.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions, complaints and abuse reports:{" "}
            <a className="underline" href="/support">
              crawler.today/support
            </a>
            .
          </p>
        </Section>
      </main>
      <LegalFooter note="Terms" />
    </div>
  );
}
