# OAuth 2.1 setup for the Crawler Room MCP server

The Crawler Room MCP endpoint is an OAuth 2.0 **protected resource** (RFC 9728). The
authorization server is this project's own Cloud auth service; Crawler Room never
issues, stores or forwards credentials.

| Value                         | Setting                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| App domain (canonical)        | `https://crawler.today`                                                     |
| Canonical MCP resource        | `https://crawler.today/api/public/mcp`                                      |
| Protected resource metadata   | `https://crawler.today/.well-known/oauth-protected-resource/api/public/mcp` |
| Authorization server (issuer) | `${SUPABASE_URL}/auth/v1`                                                   |
| Consent page                  | `https://crawler.today/oauth/consent`                                       |
| Scopes                        | `openid`, `profile` (no `email`)                                            |

Clients discover the authorization server through the protected-resource
metadata and then read the issuer's own discovery documents
(`/.well-known/openid-configuration`, `/.well-known/oauth-authorization-server`).
The app does **not** proxy or mirror those documents.

## Required environment variables

| Name                                                | Scope  | Purpose                                                                                                                                                      |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ROOM_MCP_RESOURCE`                                 | server | Canonical https resource identifier, exactly `https://crawler.today/api/public/mcp`. Mandatory in production; the value never derives from a request header. |
| `SUPABASE_URL`                                      | server | Used to build the issuer `${SUPABASE_URL}/auth/v1`.                                                                                                          |
| `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`) | server | Used by the non-persisting verification client.                                                                                                              |
| `SUBJECT_HASH_SECRET`                               | server | HMAC key for pseudonymous subjects.                                                                                                                          |

## Manual backend steps (required)

1. **Signing keys** — asymmetric ES256 keys must be active (already migrated).
   Symmetric HS256 has an empty JWKS and breaks MCP OAuth.
2. **OAuth server** — enabled, with:
   - Authorization path: `/oauth/consent`
     (`/.lovable/oauth/consent` stays available as a redirect alias)
   - Dynamic client registration: enabled
   - Site URL: `https://crawler.today`
3. **Custom Access Token Hook (optional)** — Authentication → Hooks → _Custom
   Access Token_: selecting `public.custom_access_token_hook` narrows `aud` to
   the canonical resource and adds `room_resource` / `room_scopes`. Token
   verification does **not** depend on it: OAuth tokens issued by the
   authorization server always carry a non-empty `client_id`, which is the
   binding that separates them from ordinary web sessions.

4. **Redirect allow-list** — add the callback URL that the MCP client (ChatGPT)
   displays while connecting. Use exactly the value the client shows; do not
   invent one.
5. **Anonymous sign-ins** — **REQUIRED, not optional.** Crawler Room is
   accountless: the consent page signs the visitor in with
   `signInAnonymously()`. With anonymous sign-ins disabled, no user can connect
   at all. `bun run release:check:submit` probes this live and treats a
   disabled configuration as a release blocker.

## The custom access token hook

```sql
public.custom_access_token_hook(event jsonb) returns jsonb
```

It only touches tokens that carry a non-empty `claims.client_id`, i.e. tokens
issued through the OAuth server to a registered client. For those it sets:

- `aud` → `https://crawler.today/api/public/mcp`
- `room_resource` → the same value
- `room_scopes` → `["openid","profile"]`

Ordinary web session tokens keep their existing claims untouched. The function
is **not** `SECURITY DEFINER`; only `supabase_auth_admin` may execute it.

## Threat model

- **A normal web access token cannot call the MCP server.** Verification
  requires a non-empty `client_id`, which only tokens issued through the OAuth
  server to a registered client carry. Browser sessions have none, so a stolen
  or copied app session token is rejected with `INVALID_TOKEN`. When the
  optional hook is active, `room_resource` must additionally match the
  canonical resource; a token bound to another resource is always rejected.
- **Token verification is signature-based.** `supabase.auth.getClaims(token)`
  validates the ES256 signature against the project's JWKS. Nothing is trusted
  from an unverified JWT payload. Issuer, `sub` (UUID), and `exp` are checked
  explicitly, with a request timeout on any network path.

- **Resource binding is fixed by configuration.** `ROOM_MCP_RESOURCE` is the
  only source of the canonical resource, so a spoofed `Host` header can neither
  redirect discovery nor make a token for another resource acceptable.
- **`openai/subject` authorises nothing.** It is an unauthenticated MCP `_meta`
  value. It never grants access and never links or migrates an existing legacy
  identity — that would be an ownership claim without proof. Legacy rows stay
  untouched; linking them to an account is a controlled manual migration only.
- **Data minimisation.** Only `HMAC-SHA256(SUBJECT_HASH_SECRET, "auth:" + sub)`
  is stored (`anonymous_identities.auth_user_hash`). The raw account UUID never
  reaches a domain table, a log line, tool `_meta` or a tool result.
- **Public reads stay anonymous and side-effect free.** They never resolve an
  identity, touch presence, join a room or write analytics.
