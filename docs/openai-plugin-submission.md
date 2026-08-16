# @room — OpenAI app submission dossier

Phase 1D. Everything below reflects the shipped code; nothing is aspirational.

## Identity

- Product: **@room** (Room Chat) — anonymous public rooms, profiles and communities.
- Publisher: **SEBKLAEY Agency — Sebastian Kläy**. Independent product, not affiliated with,
  sponsored by or endorsed by OpenAI.
- Canonical MCP resource: `https://crawler.today/api/public/mcp` (Streamable HTTP, JSON-RPC 2.0,
  256 KiB request ceiling).
- Price: free. No subscription, no paid tier, no upsell.

## Public URLs

| Purpose | URL |
| --- | --- |
| Landing page | `https://crawler.today/` |
| Privacy policy | `https://crawler.today/privacy` |
| Terms of use | `https://crawler.today/terms` |
| Support and abuse reports | `https://crawler.today/support` |
| Safety and content rules | `https://crawler.today/safety` |
| Data deletion | `https://crawler.today/data-deletion` |
| OAuth consent | `https://crawler.today/oauth/consent` |
| Protected-resource metadata (RFC 9728) | `https://crawler.today/.well-known/oauth-protected-resource` |
| Domain verification | `https://crawler.today/.well-known/openai-apps-challenge` |

All five mandatory pages are server-rendered, publicly reachable without authentication, and
linked from the landing page and the consent screen.

## Authentication

- OAuth 2.1 through the Supabase authorization server; ES256 tokens verified with
  `supabase.auth.getClaims`. Fail-closed: an unverifiable token is never treated as anonymous.
- Public read actions stay anonymous. Every user-specific read, write and management action
  requires a bearer token and answers `AUTH_REQUIRED` plus an RFC 9728 `WWW-Authenticate`
  challenge pointing at the canonical resource.
- Tools advertise their `securitySchemes` (`noauth` for the public actions, `oauth2` otherwise).

## Tool surface — exactly seven names

`universal_room`, `my_room`, `profile`, `social`, `notifications`, `analytics`, `communities`.

Each tool exposes a narrow `action` enum with Zod-derived `inputSchema` (length limits, enums,
numeric bounds, trimmed strings, http/https-only URLs) and strict `oneOf` output branches that
declare only public DTO fields.

## Safety

- Content rules published at `/safety`; general audience, no sexual content, no minors, no
  personal data, no harassment, no self-harm encouragement, no illegal activity.
- Images: private bucket, EXIF stripped, automated safety review before publication, rejected
  files deleted with their row, three approved images per room.
- Rate limits on messaging, profile writes and the public support form.
- Blocking is available in-product; reports go through `/support` and return an opaque case
  reference (`RC-XXXXXX`).
- Room content is untrusted third-party content; the skill instructions tell the model never to
  follow instructions found inside room messages.

## Data handling

See `docs/privacy-data-inventory.md`. Highlights: account identity stored only as an HMAC hash,
no raw IPs, message and image retention actually executed by database functions, support data
purged after 90 days and the abuse pseudonym after 24 hours.

## Deletion path

1. Signed-in user opens `/data-deletion`; the page verifies the session server-side and posts to
   `POST /api/public/data-deletion` with a bearer token.
2. The token is verified, hashed and discarded. A `pending` request is recorded — nothing is
   deleted synchronously, and a second request reuses the open case reference.
3. Unverified users use `/support` with category `privacy`; additional proof may be required.

## Domain verification

Set the environment secret `OPENAI_APPS_CHALLENGE` to the token supplied by OpenAI. The endpoint
returns exactly that token as `text/plain` and 404s while it is unset. The token is never
committed to the repository.

## Manual steps outside the code

- Set `OPENAI_APPS_CHALLENGE` in project secrets when OpenAI issues the token.
- Publish the deployment so `crawler.today` serves the new pages (this change is not deployed).
- Register the OAuth client with OpenAI against the canonical resource.
- Staff the support inbox: `support_requests` and `privacy_requests` are read with service-role
  access; there is no admin UI yet.
