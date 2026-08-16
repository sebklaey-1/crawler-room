# OAuth-Setup für den @room MCP-Server

Der MCP-Endpunkt `/api/public/mcp` ist ein OAuth-2.1-_Protected Resource_.
Autorisierungsserver ist der Auth-Stack des Projekts (Supabase Auth). Die
folgenden Schritte sind einmalig im Backend-Dashboard bzw. über die
Lovable-Cloud-Konfiguration zu erledigen — der Code enthält keine erfundenen
Werte.

## 1. Auth-Provider

| Einstellung              | Wert                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Email/Passwort-Anmeldung | aktiviert (Standard)                                                                       |
| Anonymous Sign-Ins       | optional; nur nötig, wenn `Ohne Konto fortfahren` auf der Consent-Seite funktionieren soll |
| Site URL                 | die kanonische öffentliche App-URL (aktuell `https://crawler.today`)                       |
| Redirect Allow List      | dieselbe Origin plus Preview-URLs                                                          |

## 2. OAuth-Server

| Einstellung                 | Wert                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------ |
| OAuth Server                | aktiviert                                                                            |
| Authorization Path          | `/.lovable/oauth/consent` (identische Seite liegt zusätzlich unter `/oauth/consent`) |
| Dynamic Client Registration | aktiviert (ChatGPT registriert sich selbst)                                          |
| Signaturschlüssel           | asymmetrisch (ES256) muss aktiv sein, sonst schlägt die Token-Ausgabe fehl           |

## 3. ChatGPT / OpenAI-Portal

- MCP-Server-URL: `https://<öffentliche-app-domain>/api/public/mcp`
- Die **Callback-/Redirect-URL** wird von ChatGPT beim Verbinden angezeigt.
  Genau diesen Wert aus dem OpenAI-Portal in die Redirect-Allow-List des
  Auth-Servers eintragen; er darf nicht geraten oder erfunden werden.
- Discovery-Dokumente, die der Client automatisch liest:
  - `https://<app-domain>/.well-known/oauth-protected-resource`
  - `https://<projekt-ref>.supabase.co/auth/v1/.well-known/oauth-authorization-server`

## 4. Serverseitige Umgebungsvariablen

| Name                                                  | Zweck                                                |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `SUPABASE_URL`                                        | Basis-URL des Auth-Servers für die Token-Validierung |
| `SUPABASE_PUBLISHABLE_KEY` (oder `SUPABASE_ANON_KEY`) | API-Key für den Aufruf von `/auth/v1/user`           |
| `SUPABASE_SERVICE_ROLE_KEY`                           | Datenzugriff des MCP-Servers                         |
| `SUBJECT_HASH_SECRET`                                 | HMAC-Schlüssel für den pseudonymen `subjectHash`     |
| `MESSAGE_ID_SECRET`                                   | HMAC-Schlüssel für Nachrichten-IDs                   |

## 5. Autorisierungsregeln (im Code durchgesetzt)

| Tool                        | Ohne Anmeldung                                                                                  | Mit Anmeldung                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `universal_room`            | `read`                                                                                          | `enter`, `send`                                                             |
| `public_room`               | `open`                                                                                          | `mine`, `update`, `leave`, `send`                                           |
| `profile`                   | `get` mit fremdem `username`                                                                    | eigenes `get`, `update`, `change_handle`, `set_image`, `open_link`, `block` |
| `followers_notifications`   | –                                                                                               | alle Aktionen                                                               |
| `likes`                     | –                                                                                               | alle Aktionen                                                               |
| `analytics`                 | –                                                                                               | alle Aktionen                                                               |
| `communities_organizations` | `list_communities`, `get_community`, `read_community`, `list_organizations`, `get_organization` | alle übrigen Aktionen                                                       |

Öffentliche Reads lösen keine Account-, Membership- oder Presence-Schreibvorgänge
aus. Fehlt für eine geschützte Aktion ein gültiger Token, antwortet der Server mit
`isError: true`, dem Fehlercode `AUTH_REQUIRED` bzw. `INVALID_TOKEN` und einer
`Bearer`-Challenge inklusive `resource_metadata`-URL.

## 6. Test-Hilfe

Nur mit `NODE_ENV=test` akzeptiert der Transport den Header `x-room-test-user`
als simulierten AuthContext. In Preview und Produktion wird er ignoriert.
