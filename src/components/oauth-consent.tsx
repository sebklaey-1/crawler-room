import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { SCOPE_DESCRIPTIONS } from "@/lib/room/oauth/catalog.labels";

/**
 * OAuth 2.1 consent screen of the Crawler Room authorization server.
 *
 * Accountless by design: there is no e-mail, password, sign-up or MFA step.
 * When no browser session exists, exactly one anonymous session is created;
 * the person then only confirms the connection. The session token never leaves
 * the browser except as the `Authorization` header of the consent call, and the
 * server stores only its keyed pseudonymous digest.
 */
interface ConsentDetails {
  request_id: string;
  client_name: string;
  client_uri: string | null;
  redirect_uri: string;
  scopes: string[];
  resource: string;
}

export const ANONYMOUS_UNAVAILABLE =
  "Die anonyme Verbindung ist momentan nicht möglich. Bitte versuche es später erneut — es wird kein Konto und keine E-Mail-Adresse angelegt.";

const EXPIRED = "Diese Anfrage ist abgelaufen. Bitte starte die Verbindung in ChatGPT noch einmal.";

export function OAuthConsent({ requestId }: { requestId: string | undefined }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [details, setDetails] = useState<ConsentDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anonymousStarted = useRef(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setConnected(Boolean(session));
    });

    void supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        setConnected(true);
        return;
      }
      if (anonymousStarted.current) return;
      anonymousStarted.current = true;
      const { data: created, error: anonError } = await supabase.auth.signInAnonymously();
      if (anonError || !created.session) {
        setConnected(false);
        setError(ANONYMOUS_UNAVAILABLE);
        return;
      }
      setConnected(true);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!requestId) return;
    void fetch(`/api/public/oauth/consent?request_id=${encodeURIComponent(requestId)}`)
      .then(async (response) => {
        if (!response.ok) {
          setError(EXPIRED);
          return;
        }
        setDetails((await response.json()) as ConsentDetails);
      })
      .catch(() => setError(EXPIRED));
  }, [requestId]);

  const decide = useCallback(
    (decision: "approve" | "deny") => {
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          if (!token || !requestId) {
            setError(ANONYMOUS_UNAVAILABLE);
            return;
          }
          const response = await fetch("/api/public/oauth/consent", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ request_id: requestId, decision }),
          });
          const payload = (await response.json()) as { redirect_url?: string };
          if (!response.ok || !payload.redirect_url) {
            setError(EXPIRED);
            return;
          }
          window.location.href = payload.redirect_url;
        } catch {
          setError(EXPIRED);
        } finally {
          setBusy(false);
        }
      })();
    },
    [requestId],
  );

  if (!requestId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Verbindung bestätigen</h1>
        <p className="text-muted-foreground">
          Diese Seite öffnet sich automatisch, wenn du Crawler Room in ChatGPT verbindest.
        </p>
      </main>
    );
  }

  const clientName = details?.client_name ?? "Die verbundene Anwendung";
  const scopes = details?.scopes ?? [];

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{clientName} mit Crawler Room verbinden</h1>
        <p className="text-sm text-muted-foreground">
          Ohne Konto, ohne Registrierung, ohne E-Mail oder Passwort. Lesen bleibt anonym; Schreiben,
          Folgen, Liken, Verwalten und Analytics laufen über eine pseudonyme, kontolose Verbindung.
        </p>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {connected === null && !error ? (
        <p className="text-sm text-muted-foreground">Anonyme Verbindung wird vorbereitet …</p>
      ) : null}

      {connected && details ? (
        <section className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Verbunden als anonyme Crawler Room-Identität. Es wurde kein Konto erstellt.
          </p>
          <p className="text-sm">
            <strong>{clientName}</strong> bittet um diese Berechtigungen:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {scopes.map((scope) => (
              <li key={scope}>
                {SCOPE_DESCRIPTIONS[scope] ?? `Zusätzliche Berechtigung: ${scope}`}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Rückleitung an {details.redirect_uri}</p>
          <p className="text-xs text-muted-foreground">
            Nachrichten und Bilder werden in jedem Raum spätestens nach 24 Stunden gelöscht. Du
            kannst den Zugriff jederzeit in ChatGPT entfernen. Berechtigungen von Crawler Room
            selbst — etwa Moderation und Raumregeln — gelten unverändert weiter.
          </p>
          <div className="flex gap-3">
            <Button disabled={busy} onClick={() => decide("approve")}>
              Verbindung erlauben
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => decide("deny")}>
              Abbrechen
            </Button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
