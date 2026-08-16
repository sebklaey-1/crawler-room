import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { LegalFooter } from "@/components/legal-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Support and abuse reports — @room" },
      {
        name: "description",
        content:
          "Contact @room support, report abuse in a room, or send a privacy request. Every submission returns an opaque case reference.",
      },
      { property: "og:title", content: "Support and abuse reports — @room" },
      {
        property: "og:description",
        content: "Report abuse, ask for help or send a privacy request to @room.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupportPage,
});

const CATEGORIES = [
  { value: "abuse", label: "Abuse / safety report" },
  { value: "privacy", label: "Privacy / data request" },
  { value: "technical", label: "Technical problem" },
  { value: "account", label: "Account or profile" },
  { value: "other", label: "Something else" },
] as const;

function SupportPage() {
  const [category, setCategory] = useState<string>("abuse");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [handle, setHandle] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [pending, setPending] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/public/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, subject, message, contact, handle, website }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        reference?: string;
        error?: string;
      };
      if (!response.ok || !data.ok || !data.reference) {
        setError(
          data.error === "rate_limited"
            ? "Too many submissions from this connection. Please try again later."
            : data.error === "invalid_input"
              ? "Please check the fields: subject needs at least 3 and the message at least 20 characters."
              : "The request could not be submitted. Please try again later.",
        );
        return;
      }
      setReference(data.reference);
      setSubject("");
      setMessage("");
      setContact("");
      setHandle("");
    } catch {
      setError("Network problem. Please try again later.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold tracking-tight">Support and abuse reports</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Use this form to report abuse in a room, ask for help, or send a privacy request (access,
          correction, deletion). You do not need an account to write to us. Reports are reviewed by
          a person when capacity allows — there is no automatic review and no promised response
          deadline.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          If someone is in immediate danger, contact your local emergency services first. To delete
          your own account data with verified identity, use{" "}
          <a className="underline" href="/data-deletion">
            /data-deletion
          </a>
          .
        </p>

        {reference ? (
          <div className="mt-8 rounded-lg border border-border p-6">
            <h2 className="text-lg font-semibold">Received</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your case reference is{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{reference}</code>. Keep it
              if you want to refer to this case later. Confirming receipt is not a decision about
              the case.
            </p>
            <Button className="mt-4" variant="outline" onClick={() => setReference(null)}>
              Send another message
            </Button>
          </div>
        ) : (
          <form className="mt-8 space-y-5" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <select
                id="category"
                name="category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                required
                minLength={3}
                maxLength={120}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="handle">Public handle or room this is about (optional)</Label>
              <Input
                id="handle"
                maxLength={64}
                placeholder="@handle"
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="message">What happened</Label>
              <Textarea
                id="message"
                required
                minLength={20}
                maxLength={4000}
                rows={8}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Do not include personal data of yourself or others beyond what is strictly needed.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact">Contact for a reply (optional)</Label>
              <Input
                id="contact"
                maxLength={200}
                value={contact}
                onChange={(event) => setContact(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Voluntary. Without a contact we cannot reply, only act on the report.
              </p>
            </div>

            {/* Honeypot — hidden from real users. */}
            <div aria-hidden="true" className="hidden">
              <label htmlFor="website">Website</label>
              <input
                id="website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send"}
            </Button>
          </form>
        )}
      </main>
      <LegalFooter note="Support" />
    </div>
  );
}
