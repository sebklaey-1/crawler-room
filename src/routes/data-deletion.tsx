import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { LegalFooter } from "@/components/legal-footer";
import { SupportContact } from "@/components/support-contact";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/data-deletion")({
  head: () => ({
    meta: [
      { title: "Delete your Crawler Room data" },
      {
        name: "description",
        content:
          "Request deletion of your Crawler Room profile, rooms, messages and social data. Verified through your signed-in session; unverified requests go through support.",
      },
      { property: "og:title", content: "Delete your Crawler Room data" },
      {
        property: "og:description",
        content: "How to request deletion of your Crawler Room data and what exactly is removed.",
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
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ reference: string; duplicate?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setToken(data.session?.access_token ?? null);
      setChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setToken(session?.access_token ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit() {
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/public/data-deletion", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ note }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        reference?: string;
        duplicate?: boolean;
        error?: string;
      };
      if (!response.ok || !data.ok || !data.reference) {
        setError(
          data.error === "sign_in_required"
            ? "Your session has expired. Please sign in again."
            : "The request could not be submitted. Please try again later.",
        );
        return;
      }
      setResult({ reference: data.reference, duplicate: data.duplicate === true });
    } catch {
      setError("Network problem. Please try again later.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold tracking-tight">Delete your Crawler Room data</h1>

        <section className="mt-6 space-y-3 text-sm text-muted-foreground">
          <p>
            A deletion request removes the data that belongs to your pseudonymous Crawler Room
            identity:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>your profile (handle, display name, bio, link)</li>
            <li>your personal room and its settings</li>
            <li>your messages in rooms, including any image files still stored for you</li>
            <li>your follows, likes, blocks and notifications</li>
            <li>your community memberships</li>
          </ul>
          <p>
            <strong>What stays:</strong> aggregate counters that contain no identity, moderation and
            abuse records we must keep to prevent repeat abuse, and copies of public content that
            other people already saw or quoted. Messages in shared rooms also disappear on their own
            through the retention limits described in the{" "}
            <a className="underline" href="/privacy">
              Privacy Policy
            </a>
            .
          </p>
          <p>
            Requests are recorded as pending and processed manually. There is no promised processing
            deadline and nothing is deleted at the moment you press the button.
          </p>
        </section>

        <section className="mt-10 rounded-lg border border-border p-6">
          <h2 className="text-lg font-semibold">Verified request</h2>
          {!checked ? (
            <p className="mt-2 text-sm text-muted-foreground">Checking your session…</p>
          ) : result ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {result.duplicate
                ? "You already have a pending deletion request. Reference: "
                : "Your deletion request was recorded. Reference: "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{result.reference}</code>
            </p>
          ) : token ? (
            <div className="mt-3 space-y-4">
              <p className="text-sm text-muted-foreground">
                You are signed in, so this request is verified through your session. Your access
                token is verified server-side and never stored.
              </p>
              <Textarea
                rows={4}
                maxLength={1000}
                placeholder="Optional note (e.g. which handle or room this concerns)"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button variant="destructive" disabled={pending} onClick={() => void submit()}>
                {pending ? "Sending…" : "Request deletion"}
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              You are not signed in on the web. Sign in through the Crawler Room authorization flow
              in ChatGPT and open this page again, or send an unverified request through{" "}
              <a className="underline" href="/support">
                /support
              </a>{" "}
              with the category “privacy/data request”. Unverified requests may require additional
              proof before anything is deleted.
            </p>
          )}
        </section>
      </main>
      <div className="mx-auto max-w-5xl px-6 pb-8">
        <SupportContact />
      </div>
      <LegalFooter note="Data deletion" />
    </div>
  );
}
