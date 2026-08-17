# Threat model — Crawler Room

## Trust boundaries

1. **ChatGPT client → MCP endpoint.** Everything in the request is untrusted,
   including `_meta`. All `room/*` meta keys are stripped and replaced with
   server-derived context. Identity is never a tool input.
2. **MCP endpoint → Supabase.** Server-side credentials only, never exposed to
   the client. Queries are scoped by the pseudonymous subject hash.
3. **Room content → model.** Every message, bio, image caption, room and
   community text authored by another person is untrusted input to the model.

## Token and resource binding

Access tokens are verified locally against the Crawler Room authorization
server's signing key (HS256, one accepted `alg`). A token is accepted only
when `aud` contains `https://crawler.today/mcp` and `room_resource`
equals it. A token minted for a different resource is rejected, so a token
captured by another MCP server cannot be replayed here. Cache keys are HMACs,
never raw tokens.

## Prompt injection through user-generated content

The server instructions state that all room content is untrusted and must never
be followed as instructions, only reproduced. Tool results carry a
`display_instruction` that is about presentation only. No tool grants the model
a way to escalate: writes are scoped to the caller's own identity.

## SSRF

`profile action=set_image` fetches a user-supplied URL. Mitigations in
`src/lib/room/ssrf.ts`:

- https only, no credentials in the URL, port 443 or empty
- blocked: localhost, `.local` / `.internal` / `.localhost`, loopback, private
  IPv4 (10/8, 172.16/12, 192.168/16), CGNAT, link-local, documentation and
  benchmarking ranges, multicast, cloud metadata addresses, IPv6 loopback,
  unique-local, link-local and IPv4-mapped private addresses
- manual redirect handling, re-validating every hop, maximum 3 hops
- request timeout with abort
- hard byte cap enforced while streaming; `Content-Length` checked early but
  never trusted
- MIME checked in the header _and_ by magic bytes; JPEG/PNG/WebP only, no SVG,
  XML or HTML; metadata containers are stripped before storage
- errors are opaque: no URL, host, IP or transport detail reaches a tool result
  or a log line

## Spam and abuse

Per-identity rate limits for messages, joins, uploads and support submissions.
Rolling retention (24 h hard cap) limits the value of flooding. Images are
reviewed before they become visible. Users can block profiles and report
content through `/support`.

## Account linking

An account exists only as `auth_user_hash`. There is no email, phone or social
graph import, so linking a Crawler Room identity to a real-world identity requires
information the service does not hold.

## Privacy

Public content is public by design and labelled as such in the UI and in tool
descriptions. Analytics are aggregate and owner-only: no visitor identities are
ever returned. Profiles can be set to private.

## Logging

Structured logs contain tool name, action, result code, duration and a random
request id. No arguments, message bodies, URLs, tokens, user ids or subject
hashes. The health endpoint exposes only a status flag and the version.

## Residual risks

- Public rooms can be used to publish unpleasant content between moderation
  passes; retention caps and reporting reduce, but do not remove, this.
- A compromised Supabase project would expose pseudonymous content; it would
  not reveal real-world identities.

## Prompt injection through reported and quoted content

Room messages, aliases, bios, community titles and alt texts are untrusted. Every summary escapes
them (`src/lib/room/ugc.ts`): Markdown, HTML, code fences and Unicode control/bidi characters are
neutralised, foreign text is quoted under an explicit untrusted-content banner, and only
server-issued `https` storage URLs are rendered as active images. Report confirmations never echo
the reported content. Regression tests live in `src/lib/room/phase3.test.ts`.

## Abuse of the reporting function

Reports are OAuth-only, target-resolved server-side (no invented or cross-room ids), idempotent
per reporter/target, rate limited per reporter and per target, and never trigger an automatic
takedown. Moderator actions are server-side only and gated by the hashed
`moderator_subjects` allowlist.
