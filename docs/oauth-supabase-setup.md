# OAuth 2.1 setup for the Crawler Room MCP server

Crawler Room runs its **own** OAuth 2.1 authorization server on
`https://crawler.today`. There is no external identity provider and **no
Supabase Custom Access Token Hook** anywhere in the runtime, release or
submission path. Supabase / Lovable Cloud is used only as the database and for
an internal anonymous browser identity on the consent page; Supabase session
JWTs are never accepted as MCP access tokens.

| Value                         | Setting                                                          |
| ----------------------------- | ---------------------------------------------------------------- |
| App domain (canonical)        | `https://crawler.today`                                          |
| Canonical MCP resource        | `https://crawler.today/mcp`                                      |
| Protected resource metadata   | `https://crawler.today/.well-known/oauth-protected-resource/mcp` |
| Authorization server (issuer) | `https://crawler.today`                                          |
| AS metadata (RFC 8414)        | `https://crawler.today/.well-known/oauth-authorization-server`   |
| Registration (DCR, RFC 7591)  | `https://crawler.today/oauth/register`                           |
| Authorization endpoint        | `https://crawler.today/oauth/authorize`                          |
| Token endpoint                | `https://crawler.today/oauth/token`                              |
| Consent page                  | `https://crawler.today/oauth/consent`                            |
| Scopes                        | `room:private`, `room:write`                                     |

The protected-resource metadata lists exactly one authorization server:
`https://crawler.today`.

## Required environment variables

| Name                                                | Scope  | Purpose                                                                                                                     |
| --------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| `ROOM_MCP_RESOURCE`                                 | server | Canonical https resource identifier, exactly `https://crawler.today/mcp`. Never derived from a request header.              |
| `ROOM_OAUTH_SIGNING_SECRET`                         | server | Server-only ≥64-byte secret used to sign/verify the self-issued HS256 access tokens. Stored in Lovable Cloud secrets/Vault. |
| `SUPABASE_URL`                                      | server | Database access.                                                                                                            |
| `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`) | server | Anonymous browser identity for the consent page.                                                                            |
| `SUBJECT_HASH_SECRET`                               | server | HMAC key for pseudonymous subjects.                                                                                         |

The signing secret is read lazily inside request handlers, never at module
scope, never sent to the browser and never logged or printed by any script.

## Flow

1. **Discovery** — the client reads the PRM for `/mcp`, then the AS metadata on
   `https://crawler.today`.
2. **Registration** — public clients register via DCR with
   `token_endpoint_auth_method = "none"`; redirect URIs are stored verbatim and
   matched exactly (no prefix or wildcard matching).
3. **Authorization** — `/oauth/authorize` requires PKCE `S256`, an exactly
   matching `redirect_uri`, the requested `resource`
   (`https://crawler.today/mcp`) and the scopes `room:private` / `room:write`.
   The consent page identifies the visitor through an internal anonymous
   browser identity; it makes **no** `supabase.auth.oauth.*` calls.
4. **Token** — `/oauth/token` exchanges the single-use authorization code
   (stored only as a hash, redeemed race-safe) for a self-issued HS256 JWT with
   exactly `iss = https://crawler.today`, `aud = resource =
https://crawler.today/mcp`, `client_id`, `scope`, `sub`, `iat`, `exp`.
   Refresh tokens are stored hashed and rotated on every use; reuse of a
   rotated token revokes the chain.

## Manual backend steps (required)

1. **`ROOM_OAUTH_SIGNING_SECRET`** configured as a server-only secret.
2. **Anonymous sign-ins enabled** — REQUIRED, not optional. Crawler Room is
   accountless; the consent page needs an internal anonymous browser identity.
   `bun run release:check:submit` probes this live and treats a disabled
   configuration as a release blocker.
3. **OpenAI portal / client callback** — the MCP client registers itself via
   DCR, so no manual redirect allow-list maintenance is needed on the
   authorization server.

No dashboard auth-hook toggle exists in this design.

## Threat model

- **A Supabase session token cannot call the MCP server.** The verifier accepts
  only tokens whose issuer is `https://crawler.today`, signed with
  `ROOM_OAUTH_SIGNING_SECRET`, carrying a non-empty `client_id` and bound to
  the canonical resource. `aud = authenticated`, Supabase issuers, tokens bound
  to the deprecated `https://crawler.today/api/public/mcp` resource, wrong or
  missing scopes, wrong `client_id`, wrong issuer and invalid signatures are
  all rejected with `INVALID_TOKEN`.
- **Token verification is signature-based.** Nothing is trusted from an
  unverified JWT payload; `iss`, `aud`/`resource`, `client_id`, `scope`, `sub`
  and `exp` are checked explicitly.
- **Resource binding is fixed by configuration.** `ROOM_MCP_RESOURCE` is the
  only source of the canonical resource, so a spoofed `Host` header can neither
  redirect discovery nor make a token for another resource acceptable.
- **`openai/subject` authorises nothing.** It is an unauthenticated MCP `_meta`
  value. It never grants access and never links or migrates an existing legacy
  identity.
- **Data minimisation.** Only `HMAC-SHA256(SUBJECT_HASH_SECRET, "auth:" + sub)`
  is stored (`anonymous_identities.auth_user_hash`). The raw account UUID never
  reaches a domain table, a log line, tool `_meta` or a tool result.
- **Public reads stay anonymous and side-effect free.** They never resolve an
  identity, touch presence, join a room or write analytics.
