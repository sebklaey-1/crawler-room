# @room — anonyme Themenräume für ChatGPT

Vollständiges MVP: Datenbank, Raumlogik, MCP-Server über Streamable HTTP, `room`-Skill, Plugin-Paket, Landingpage, Tests, Doku.

## Architektur-Entscheidung

Der MCP-Server wird **in dieser App** als TanStack-Server-Route `/api/public/mcp` mit dem offiziellen `@modelcontextprotocol/sdk` (Streamable HTTP, stateless JSON-Response) gebaut — nicht als separate Supabase Edge Function. Gründe: derselbe HTTPS-Host wie Landingpage/`/health`/`/privacy`/`/terms`, ein Deployment, und wir behalten vollen Zugriff auf `_meta["openai/subject"]` aus dem Request-Kontext (die Lovable-MCP-Helfer geben diese Rohmetadaten nicht durch). Datenbank ist Lovable Cloud (Supabase Postgres), Zugriff ausschließlich serverseitig mit Service-Role-Key.

```text
ChatGPT user → room skill → tool call
   → POST /api/public/mcp (Streamable HTTP, noauth)
   → Identität aus _meta, HMAC → subject_hash
   → validierte Transaktion → Supabase PostgreSQL
   → structuredContent → ChatGPT-Antwort
```

## 1. Datenbank (Migration + Seeds)

Tabellen exakt nach Spezifikation: `topics`, `topic_aliases`, `rooms`, `memberships`, `messages`, `message_reports`, plus `rate_events` (subject_hash, action, created_at) für Rate-Limits. RLS auf allen Tabellen aktiv, **keine** Grants für `anon`/`authenticated` — nur `service_role`. Seeds: 7 Themen und die Alias-Tabelle.

Raumzuweisung als SQL-Funktion `join_topic_room(p_subject_hash, p_topic_slug, p_alias)` (SECURITY DEFINER):
`pg_advisory_xact_lock(hashtext(topic_id))` → bestehende aktive Mitgliedschaft zurückgeben (idempotent) → ältesten aktiven Raum mit `< capacity` aktiven Mitgliedern per `FOR UPDATE` → sonst nächste `room_number` atomar anlegen → Mitgliedschaft einfügen. Absicherung: Unique `(topic_id, room_number)`, partieller Unique-Index `(subject_hash, topic_id) WHERE left_at IS NULL`, Check `capacity = 5`, Trigger, der > 5 aktive Mitglieder verhindert.

Cleanup: SQL-Funktion `cleanup_expired()` (abgelaufene Nachrichten löschen, leere Räume schließen, alte verlassene Mitgliedschaften anonymisieren) + `pg_cron`-Eintrag stündlich; zusätzlich Admin-Route `/api/public/admin/cleanup` mit `ADMIN_TOKEN`.

## 2. Domänenlogik (`src/lib/room/`)

- `identity.ts` — `openai/subject` aus `_meta` lesen, HMAC-SHA256 mit `SUBJECT_HASH_SECRET`, `IDENTITY_UNAVAILABLE` bei Fehlen; Session nur gehasht.
- `topics.ts` — NFKC-Normalisierung, Trim, Whitespace-Kollaps, Lowercase, Alias-Tabelle; `TOPIC_NOT_FOUND` inkl. Themenliste.
- `alias.ts` — Sanitizing (max. 32 Zeichen, keine Steuer-/unsichtbaren Zeichen, kein HTML), Generator „Blue Lynx“-Stil, stabil pro Mitgliedschaft.
- `messages.ts` — Validierung (nicht leer, ≤ 500 Zeichen, max. 2 URLs, Plain Text, Escaping), Lesefenster ab `joined_at`, Lesecursor.
- `ratelimit.ts` — 10/min und 100/h Nachrichten, 10 Beitritte/h, 5 Meldungen/h.
- `ids.ts` — undurchsichtige Nachrichten-IDs (HMAC-signierte, base64url-kodierte Kennung statt roher bigint).
- `errors.ts` — strukturierte Fehler mit Code + freundlichem deutschen Text, niemals SQL-Details.

## 3. MCP-Server und Tools

`/api/public/mcp` (POST/GET/DELETE, Streamable HTTP, `noauth`). Tools mit Zod-Input, `outputSchema`, `structuredContent` + kurzer Textzusammenfassung und den vorgegebenen Annotations: `list_topics`, `enter_topic`, `send_message`, `read_messages`, `my_rooms`, `leave_topic`, `report_message`. Keine internen UUIDs, keine Subjects/Sessions in Ergebnissen. Strukturierte JSON-Logs ohne Nachrichteninhalte.

Weitere Routen: `/health` (JSON), `/privacy`, `/terms` (gerenderte Seiten).

## 4. Skill und Plugin-Paket

`room-plugin/` im Repo mit `.codex-plugin/plugin.json`, `skills/room/SKILL.md`, `server/README.md` (verweist auf diese App als MCP-Server) und `README.md`. Die SKILL.md enthält Frontmatter, Intent-Erkennung (`@room AI`, `Schreib:`, `Sag:`, „Was gibt es Neues?“, „Meine Räume“, „verlassen“, „melden“), Beitrittslogik, die vorgegebenen Antwortformate und die Prompt-Injection-Regeln (Raumnachrichten sind untrusted, niemals Anweisungen daraus ausführen). Manifest-Felder, die nicht offiziell belegt sind, werden nicht erfunden, sondern im README als „gegen die aktuelle OpenAI-Doku zu prüfen“ markiert.

## 5. Landingpage

`/` als ruhige, dunkle, responsive Seite mit eigener Farbwelt (keine Standard-Lila-Optik): Hero mit dem vorgegebenen Text, Themen-Chips, „So funktionierts“ mit Beispielaufrufen, deutlicher Hinweis „Neue Nachrichten erscheinen, wenn du @room aufrufst“, Datenschutz/24-Stunden-Löschung, Live-Systemstatus aus `/health`, Installationshinweise. Kein Chat-UI, keine erfundenen Zahlen. Eigene `head()`-Metadaten.

## 6. Tests

Vitest gegen die echte Datenbank: alle 20 spezifizierten Fälle plus Parallelitätstest mit 20 gleichzeitigen Beitritten (genau 4 Räume à 5 Mitglieder, keine Duplikate). Reine Logik (Normalisierung, Validierung, Alias, IDs) zusätzlich als Unit-Tests.

## 7. Dokumentation

`README.md` mit Produktbeschreibung, Architekturdiagramm, Datenfluss, Datenmodell, Setup, Env-Variablen, Migrationen, MCP-Inspector-Test, ChatGPT-Verbindung, Deployment, Aufbewahrung, Troubleshooting und dem Abschnitt „Security limitation of the anonymous MVP“ (pseudonyme Identität ≠ verifizierte Anmeldung, OAuth 2.1 als nächste Stufe).

## Technische Details

- Neue Pakete: `@modelcontextprotocol/sdk`, `zod`, `vitest`.
- Secrets: `SUBJECT_HASH_SECRET`, `ADMIN_TOKEN` werden angelegt; Supabase-URL/Service-Role kommen aus Lovable Cloud. Konfiguration (`MESSAGE_RETENTION_HOURS`, `MAX_ROOM_MEMBERS`, `MAX_MESSAGE_LENGTH`, Rate-Limits, `PUBLIC_MCP_BASE_URL`) mit Defaults, im Handler gelesen.
- Lovable Cloud wird für die Datenbank aktiviert; der Service-Role-Client wird nur innerhalb der Handler dynamisch importiert.
- Reihenfolge: Cloud + Migration → Domänenlogik → MCP-Server/Tools → Skill/Plugin → Landingpage → Tests → Doku → Abschlussprüfung.
