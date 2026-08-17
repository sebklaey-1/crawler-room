# Crawler Room — data inventory

Internal companion to the public [Privacy Policy](../src/routes/privacy.tsx). It lists what the
running system actually stores, where, and for how long. No aspirational entries.

Canonical MCP resource: `https://crawler.today/mcp`.

## Identity

| Item              | Storage                                                  | Notes                                                                                         |
| ----------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Account identity  | `anonymous_identities.auth_user_hash`                    | HMAC-SHA256(`SUBJECT_HASH_SECRET`, account id). Raw account id and access token never stored. |
| Pseudonym / alias | `anonymous_identities.custom_alias`, `memberships.alias` | User-chosen, public.                                                                          |
| Handle            | `user_rooms.handle`, `handle_redirects.old_handle`       | Public, case-insensitively unique.                                                            |

## Content

| Item              | Storage                                          | Retention (enforced)                                                                                                                                     |
| ----------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text messages     | `messages`                                       | Newest 7 per room; time-based rooms additionally expire after `retention_hours` (24h default). Executed by `enforce_text_retention` / `cleanup_expired`. |
| Images (metadata) | `image_messages`                                 | Newest 3 approved per room; pending >30 min, rejected and failed purged. `enforce_image_retention`, `purge_dead_images`.                                 |
| Image files       | Storage bucket `room-images` (private)           | Deleted together with the row; served only as short-lived signed URLs.                                                                                   |
| Profile fields    | `user_rooms`                                     | Until changed or deleted by the owner.                                                                                                                   |
| Communities       | `organizations`, `organization_members`, `rooms` | Until deleted by an admin.                                                                                                                               |

## Social and operational

| Item                     | Storage                                             | Retention                                                    |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------------ |
| Follows / likes / blocks | `room_followers`, `content_likes`, `profile_blocks` | Until undone or account deletion.                            |
| Notifications            | `room_notifications`                                | 30 days.                                                     |
| Presence                 | `memberships.last_seen_at`                          | Overwritten; 3-minute live window.                           |
| Left memberships         | `memberships`                                       | Alias and pseudonym anonymised 7 days after leaving.         |
| Rate-limit events        | `rate_events`                                       | 2 hours.                                                     |
| Analytics counters       | `analytics_events`                                  | Aggregate counts, room owner hash only, no visitor identity. |

## Support and privacy requests (Phase 1D)

| Item                       | Storage                                                                         | Retention                                                                         |
| -------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Support / abuse report     | `support_requests` (reference, category, subject, body, contact, public_target) | 90 days, executed by `cleanup_support_requests`.                                  |
| Abuse-protection pseudonym | `support_requests.requester_hash`                                               | Keyed hash of trusted request metadata; cleared after 24 hours. No raw IP stored. |
| Deletion request           | `privacy_requests` (reference, request_type, auth_user_hash, status, note)      | Kept while pending; deleted 90 days after completion or rejection.                |

Both tables have RLS enabled with no public policy; access is `service_role` only through server
routes.

## Not stored

- Raw IP addresses, raw access tokens, raw OpenAI subject values.
- Payment data (the product is free; no billing surface is exposed).
- Message content in logs. Log lines contain tool name, outcome, error code, duration.

## Secrets

`SUBJECT_HASH_SECRET`, `MESSAGE_ID_SECRET`, `ADMIN_TOKEN`, `OPENAI_APPS_CHALLENGE` and the
Supabase service credentials are server-side environment values, never returned by a tool.

## Response denylist

Tool output schemas are audited by `src/lib/room/legal.test.ts`: no `subject_hash`,
`owner_subject_hash`, `auth_user_hash`, `storage_path`, `membership_id`, `account_id`,
`requester_hash`, `access_token` or billing identifiers may appear in any declared output.
