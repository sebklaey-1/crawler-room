import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

/**
 * OAuth 2.1 consent screen for the @room MCP server.
 *
 * The authorization server sends the person here with an `authorization_id`.
 * Approval and denial go through the official Supabase OAuth server methods;
 * no token ever appears in the URL or on screen.
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
  openid: "Deine Anmeldung bei @room bestätigen",
  profile: "Dein @room-Basisprofil teilen",
};

export function OAuthConsent({ authorizationId }: { authorizationId: string | undefined }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [accountLabel, setAccountLabel] = useState<string | null>(null);
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
      setAccountLabel(
        data.session?.user.email ?? (data.session?.user.is_anonymous ? "Gastkonto" : null),
      );
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
      setAccountLabel(session?.user.email ?? (session?.user.is_anonymous ? "Gastkonto" : null));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!signedIn || !authorizationId) return;
    const api = oauthApi();
    if (!api) {
      setError("Die Anmeldung ist gerade nicht verfügbar. Bitte versuche es später erneut.");
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
  }, [signedIn, authorizationId]);

  const withBusy = useCallback(async (run: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
    } finally {
      setBusy(false);
    }
  }, []);

  const signIn = useCallback(
    (mode: "in" | "up") =>
      withBusy(async () => {
        setNotice(null);
        const result =
          mode === "in"
            ? await supabase.auth.signInWithPassword({ email, password })
            : await supabase.auth.signUp({
                email,
                password,
                options: { emailRedirectTo: window.location.href },
              });
        if (result.error) {
          setError(result.error.message);
          return;
        }
        if (mode === "up" && !result.data.session) {
          setNotice("Bitte bestätige deine E-Mail-Adresse und komm dann auf diese Seite zurück.");
        }
      }),
    [email, password, withBusy],
  );

  const continueAsGuest = useCallback(
    () =>
      withBusy(async () => {
        const { error: guestError } = await supabase.auth.signInAnonymously();
        if (guestError)
          setError("Ohne Konto ist die Verbindung hier nicht möglich. Bitte melde dich an.");
      }),
    [withBusy],
  );

  const decide = useCallback(
    (action: "approve" | "deny") =>
      withBusy(async () => {
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
      }),
    [authorizationId, withBusy],
  );

  if (!authorizationId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Zugriff bestätigen</h1>
        <p className="text-muted-foreground">
          Diese Seite öffnet sich automatisch, wenn du @room in ChatGPT verbindest.
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
        <h1 className="text-2xl font-semibold">{clientName} mit @room verbinden</h1>
        <p className="text-sm text-muted-foreground">
          Lesen ist ohne Anmeldung möglich. Schreiben, Folgen, Liken, Verwalten und Analytics
          brauchen dein Konto.
        </p>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

      {signedIn === false ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn("in");
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="consent-email">E-Mail</Label>
            <Input
              id="consent-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="consent-password">Passwort</Label>
            <Input
              id="consent-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy}>
              Anmelden
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void signIn("up")}
            >
              Konto erstellen
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void continueAsGuest()}
            >
              Ohne Konto fortfahren
            </Button>
          </div>
        </form>
      ) : null}

      {signedIn ? (
        <section className="space-y-4">
          {accountLabel ? (
            <p className="text-sm text-muted-foreground">Angemeldet als {accountLabel}</p>
          ) : null}
          <p className="text-sm">
            <strong>{clientName}</strong> darf @room in deinem Namen nutzen: Nachrichten schreiben,
            Räume und Profil verwalten, folgen und liken.
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
            Die Regeln von @room gelten weiterhin. Du kannst den Zugriff jederzeit in ChatGPT
            entfernen.
          </p>
          <div className="flex gap-3">
            <Button disabled={busy || !details} onClick={() => void decide("approve")}>
              Zugriff erlauben
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void decide("deny")}>
              Verbindung abbrechen
            </Button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
