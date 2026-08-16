import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

interface ConsentSearch {
  authorization_id: string | undefined;
}

/**
 * OAuth 2.1 consent page for the @room MCP server.
 *
 * The authorization server (this project's auth service) sends the person here
 * with an `authorization_id`. After sign-in the page shows which client asks
 * for access and forwards the explicit approval or denial. No tokens are ever
 * stored or displayed here.
 */
export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): ConsentSearch => ({
    authorization_id: typeof search["authorization_id"] === "string" ? search["authorization_id"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "@room Zugriff bestätigen" },
      { name: "description", content: "Bestätige den Zugriff einer Anwendung auf dein @room-Konto." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "@room Zugriff bestätigen" },
      { property: "og:description", content: "Zugriff einer Anwendung auf dein @room-Konto bestätigen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConsentPage,
});

const SUPABASE_URL = import.meta.env["VITE_SUPABASE_URL"] as string;
const SUPABASE_KEY = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string;

interface AuthorizationDetails {
  client?: { name?: string; client_name?: string; client_uri?: string };
  scope?: string;
  redirect_uri?: string;
}

function ConsentPage() {
  const { authorization_id: authorizationId } = Route.useSearch();
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) =>
      setToken(session?.access_token ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!token || !authorizationId) return;
    void (async () => {
      try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/oauth/authorizations/${authorizationId}`, {
          headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
        });
        if (!response.ok) throw new Error("unavailable");
        setDetails((await response.json()) as AuthorizationDetails);
      } catch {
        setError("Diese Anfrage ist abgelaufen. Bitte starte die Verbindung in ChatGPT neu.");
      }
    })();
  }, [token, authorizationId]);

  const signIn = useCallback(
    async (mode: "in" | "up") => {
      setBusy(true);
      setError(null);
      setNotice(null);
      const result =
        mode === "in"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: window.location.href },
            });
      setBusy(false);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      if (mode === "up" && !result.data.session) {
        setNotice("Bitte bestätige deine E-Mail-Adresse und komm dann auf diese Seite zurück.");
      }
    },
    [email, password],
  );

  const decide = useCallback(
    async (action: "approve" | "deny") => {
      if (!authorizationId || !token) return;
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(
          `${SUPABASE_URL}/auth/v1/oauth/authorizations/${authorizationId}/consent`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
              apikey: SUPABASE_KEY,
            },
            body: JSON.stringify({ action }),
          },
        );
        const body = (await response.json()) as { redirect_url?: string };
        if (!response.ok || !body.redirect_url) throw new Error("failed");
        window.location.href = body.redirect_url;
      } catch {
        setBusy(false);
        setError("Das hat nicht geklappt. Bitte starte die Verbindung in ChatGPT neu.");
      }
    },
    [authorizationId, token],
  );

  if (!authorizationId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Zugriff bestätigen</h1>
        <p className="text-muted-foreground">
          Diese Seite wird automatisch geöffnet, wenn du @room in ChatGPT verbindest.
        </p>
      </main>
    );
  }

  const clientName = details?.client?.name ?? details?.client?.client_name ?? "Eine Anwendung";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">@room Zugriff bestätigen</h1>
        <p className="text-sm text-muted-foreground">
          Lesen ist ohne Anmeldung möglich. Schreiben, Folgen, Liken und Verwalten brauchen dein Konto.
        </p>
      </header>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

      {!token ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn("in");
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="email">E-Mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Passwort</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="flex gap-3">
            <Button type="submit" disabled={busy}>
              Anmelden
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void signIn("up")}>
              Konto erstellen
            </Button>
          </div>
        </form>
      ) : (
        <section className="space-y-4">
          <p className="text-sm">
            <strong>{clientName}</strong> möchte in deinem Namen auf @room zugreifen: Nachrichten schreiben,
            Räume und Profil verwalten, folgen und liken.
          </p>
          <p className="text-xs text-muted-foreground">
            Du kannst den Zugriff jederzeit widerrufen, indem du die Verbindung in ChatGPT entfernst.
          </p>
          <div className="flex gap-3">
            <Button disabled={busy} onClick={() => void decide("approve")}>
              Zugriff erlauben
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void decide("deny")}>
              Ablehnen
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
