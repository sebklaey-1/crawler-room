# Data flow — @room

```text
ChatGPT client
   |  JSON-RPC 2.0 over Streamable HTTP (JSON or SSE)
   v
https://crawler.today/api/public/mcp        (TanStack server route, edge Worker)
   |  1. transport checks: 256 KiB body cap, content-type, Accept, origin
   |  2. bearer validation via Supabase auth (getClaims, ES256)
   |  3. subject -> auth_user_hash = HMAC(secret, "auth:" + sub)
   |  4. action authorisation (public read vs protected action)
   |  5. domain handler
   v
Supabase (Postgres + Storage)
   |  rows keyed by pseudonymous hashes only
   v
   ^  handler result
   |  6. runtime output contract: reduce to published schema, strip internals
   |  7. summary text + structuredContent
ChatGPT client
```

## What is stored

| Data                                                | Where                                  | Retention                            |
| --------------------------------------------------- | -------------------------------------- | ------------------------------------ |
| Pseudonymous identity (`auth_user_hash`)            | `anonymous_identities`                 | until deletion request               |
| Alias / handle, profile fields, bio, location, link | `user_rooms`                           | until deletion request               |
| Room and community messages                         | `messages`                             | max 24 h; newest 7 per room          |
| Images                                              | Storage + `image_messages`             | max 24 h; newest 3 approved per room |
| Follows, likes, notification settings               | relational tables                      | until removed by the user            |
| Aggregated analytics counters                       | analytics tables                       | rolling window, owner-only           |
| Support / privacy requests                          | `support_requests`, `privacy_requests` | 90 days                              |

## What is never stored or returned

- Raw OpenAI or Supabase subject identifiers, emails, tokens.
- IP addresses tied to content.
- Internal UUIDs, account/owner ids, storage paths or database errors in tool
  results — removed by `src/lib/room/output.ts`.

## Direction of traffic

Strictly pull-only. The server never calls ChatGPT, never opens a WebSocket and
never sends push notifications. Notifications are collected and surfaced the
next time the user calls a tool.

## Outbound requests

Exactly one: fetching a profile avatar/banner from a public https URL the user
supplies. That path is SSRF-hardened (`src/lib/room/ssrf.ts`).

## Infrastructure

Supabase provides Postgres, Auth and Storage. Lovable provides hosting for the
Worker runtime that serves `crawler.today`. Both act as processors for the data
described above.
