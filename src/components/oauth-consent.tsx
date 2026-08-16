import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { LEGAL_LINKS } from "@/lib/room/legal";

/**
 * OAuth 2.1 consent screen for the Crawler Room MCP server.
 *
 * Accountless by design: there is no e-mail, password, sign-up or MFA step.
 * When no Supabase session exists, exactly one anonymous session is created
 * with the official `signInAnonymously()` method; the person then only
 * confirms the connection. If anonymous sign-ins are disabled we fail closed
 * and explain it — we never fall back to `openai/subject` as a write bypass.
 */
interface AuthorizationDetails {
  client?: { name?: string; client_name?: string; client_uri?: string } | null;
  redirect_uri?: string;
  scope?: string;
  redirect_url?: string;
  redirect_to?: string;
}

interface OAuthNamespace {
  getAuthorizationDetails: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: unknown }>;
  approveAuthorization: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: unknown }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: unknown }>;
}

function oauthApi(): OAuthNamespace | null {
  const api = (supabase.auth as unknown as { oauth?: OAuthNamespace }).oauth;
  return api ?? null;
}

const SCOPE_LABELS: Record<string, string> = {
  openid: "Deine anonyme Crawler-Room-Verbindung bestätigen",
  profile: "Dein öffentliches Crawler Room-Basisprofil teilen",
};

export const ANONYMOUS_UNAVAILABLE =
  "Die anonyme Verbindung ist momentan nicht möglich. Bitte versuche es später erneut — es wird kein Konto und keine E-Mail-Adresse angelegt.";

export function OAuthConsent({ authorizationId }: { authorizationId: string | undefined }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anonymousStarted = useRef(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setConnected(Boolean(session));
    });

    void supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        // Reuse the existing session; never create a second one.
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
    if (!connected || !authorizationId) return;
    const api = oauthApi();
    if (!api) {
      setError("Die Verbindung ist gerade nicht verfügbar. Bitte versuche es später erneut.");
      return;
    }
    void api.getAuthorizationDetails(authorizationId).then(({ data, error: detailsError }) => {
      if (detailsError || !data) {
        setError("Diese Anfrage ist abgelaufen. Bitte starte die Verbindung in ChatGPT neu.");
        return;
      }
      const immediate = data.redirect_url ?? data.redirect_to;
      if (immediate && !data.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    });
  }, [connected, authorizationId]);

  const decide = useCallback(
    (action: "approve" | "deny") => {
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          const api = oauthApi();
          if (!api || !authorizationId) return;
          const { data, error: decisionError } =
            action === "approve"
              ? await api.approveAuthorization(authorizationId)
              : await api.denyAuthorization(authorizationId);
          const target = data?.redirect_url ?? data?.redirect_to;
          if (decisionError || !target) {
            setError("Das hat nicht geklappt. Bitte starte die Verbindung in ChatGPT neu.");
            return;
          }
          window.location.href = target;
        } finally {
          setBusy(false);
        }
      })();
    },
    [authorizationId],
  );

  if (!authorizationId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Verbindung bestätigen</h1>
        <p className="text-muted-foreground">
          Diese Seite öffnet sich automatisch, wenn du Crawler Room in ChatGPT verbindest.
        </p>
      </main>
    );
  }

  const clientName =
    details?.client?.name ?? details?.client?.client_name ?? "Die verbundene Anwendung";
  // Only the scopes the client actually requested are shown.
  const scopes = (details?.scope ?? "openid profile").split(/\s+/).filter(Boolean);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{clientName} mit Crawler Room verbinden</h1>
        <p className="text-sm text-muted-foreground">
          Ohne Konto, ohne Registrierung, ohne E-Mail oder Passwort. Lesen bleibt anonym; Schreiben,
          Folgen, Liken, Verwalten und Analytics laufen über eine pseudonyme, kontolose Verbindung,
          die deine Inhalte schützt.
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

      {connected ? (
        <section className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Verbunden als anonyme Crawler Room-Identität. Es wurde kein Konto erstellt.
          </p>
          <p className="text-sm">
            <strong>{clientName}</strong> darf Crawler Room für dich nutzen: Nachrichten schreiben, deinen
            Raum und dein Profil verwalten, folgen und liken.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {scopes.map((scope) => (
              <li key={scope}>{SCOPE_LABELS[scope] ?? `Zusätzliche Berechtigung: ${scope}`}</li>
            ))}
          </ul>
          {details?.redirect_uri ? (
            <p className="text-xs text-muted-foreground">Rückleitung an {details.redirect_uri}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Nachrichten und Bilder werden in jedem Raum spätestens nach 24 Stunden gelöscht. Du
            kannst den Zugriff jederzeit in ChatGPT entfernen.
          </p>
          <div className="flex gap-3">
            <Button disabled={busy || !details} onClick={() => decide("approve")}>
              Verbindung erlauben
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => decide("deny")}>
              Verbindung abbrechen
            </Button>
          </div>
          <nav aria-label="Legal and support" className="flex flex-wrap gap-x-4 gap-y-2 pt-2">
            {LEGAL_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-xs text-muted-foreground underline underline-offset-4"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </section>
      ) : null}
    </main>
  );
}
