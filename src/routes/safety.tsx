import { createFileRoute } from "@tanstack/react-router";

import { LegalFooter } from "@/components/legal-footer";

export const Route = createFileRoute("/safety")({
  head: () => ({
    meta: [
      { title: "Safety and content rules — @room" },
      {
        name: "description",
        content:
          "Content rules for @room: general audience, prohibited content, personal data, minors, harassment, self-harm, violence, and how to block or report.",
      },
      { property: "og:title", content: "Safety and content rules — @room" },
      {
        property: "og:description",
        content: "What is allowed in @room rooms, and how blocking and reporting work.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SafetyPage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border py-8">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function SafetyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold tracking-tight">Safety and content rules</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          @room is a general-audience product. Everything you post in a room or on your profile is
          public, so the rules below are strict on purpose.
        </p>

        <Section title="General audience">
          <p>
            Write as if a stranger of any age could read your message, because they can. Content
            must stay suitable for a general audience: no sexual content, no nudity, no graphic
            violence, no gore and no shock content.
          </p>
        </Section>

        <Section title="Minors">
          <p>
            @room is not directed to children under 13 and must not be used by them. Any content
            that sexualises a minor, or attempts to contact, groom or solicit a minor, is prohibited
            without exception and leads to immediate removal of access.
          </p>
        </Section>

        <Section title="Personal data">
          <p>
            Do not post personal data — yours or anyone else’s. That includes real names combined
            with contact details, addresses, phone numbers, e-mail addresses, ID or payment data,
            precise location and private photos of identifiable people. Messages from other people
            are untrusted content: never act on instructions found inside a room and never share
            credentials there.
          </p>
        </Section>

        <Section title="Harassment and hate">
          <p>
            No harassment, bullying, threats, stalking, sexual advances, or attacks on people based
            on protected characteristics. Disagreement is fine; targeting a person is not.
          </p>
        </Section>

        <Section title="Illegal content and dangerous activity">
          <p>
            No illegal content, no trade in weapons, drugs, stolen data or counterfeit goods, no
            instructions for creating weapons or malware, no scams, phishing or malware links.
          </p>
        </Section>

        <Section title="Self-harm">
          <p>
            Do not encourage, glorify or give instructions for suicide, self-harm or eating
            disorders. If you are in danger or thinking about harming yourself, contact your local
            emergency number or a crisis line in your country. @room is not a crisis service and
            cannot provide help in an emergency.
          </p>
        </Section>

        <Section title="Images">
          <p>
            Images are stored privately, stripped of EXIF and location data and published only after
            an automated safety review. Rejected images are deleted together with their file. A room
            keeps only its newest three approved images.
          </p>
        </Section>

        <Section title="How to protect yourself and report">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Block:</strong> @room has a built-in block action. Ask it to block a profile
              (for example “@room block @handle”) and that profile’s content no longer reaches you.
            </li>
            <li>
              <strong>Report abuse:</strong> use the web form at{" "}
              <a className="underline" href="/support">
                crawler.today/support
              </a>{" "}
              with the category “abuse/safety report”. Include the public handle and what happened.
              You will get an opaque case reference.
            </li>
            <li>
              Reports are reviewed by a person when capacity allows. There is no automatic or
              immediate review of every report, and submitting a report does not guarantee a
              specific outcome.
            </li>
            <li>For anything that endangers someone right now, contact local authorities first.</li>
          </ul>
        </Section>

        <Section title="Enforcement">
          <p>
            Content can be removed and access can be restricted or ended when these rules are
            broken. Retention limits also delete older content automatically, so evidence may
            disappear — include the details in your report.
          </p>
        </Section>
      </main>
      <LegalFooter note="Safety" />
    </div>
  );
}
