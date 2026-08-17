# OpenAI review checklist — Crawler Room

Status document for the app-directory submission of Crawler Room. Nothing here claims
that an approval exists or is guaranteed; it records what the implementation
actually does today.

- Canonical MCP resource: `https://crawler.today/mcp`
- Canonical app origin: `https://crawler.today`
- Transport: Streamable HTTP (JSON and SSE), pull-only. No push, no WebSocket.

## 1. Tool surface — exactly seven tools

| Tool                        | Actions                                                                                                                                                                                                                                                                                     | Public (no token)                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `universal_room`            | `enter`, `read`, `send`                                                                                                                                                                                                                                                                     | `read`                                                                                          |
| `public_room`               | `mine`, `open`, `update`, `leave`, `send`                                                                                                                                                                                                                                                   | `open`                                                                                          |
| `profile`                   | `get`, `update`, `change_handle`, `set_image`, `open_link`, `block`                                                                                                                                                                                                                         | `get`                                                                                           |
| `followers_notifications`   | `follow`, `unfollow`, `list_followers`, `list_following`, `list_notifications`, `update_settings`                                                                                                                                                                                           | —                                                                                               |
| `likes`                     | `like`, `unlike`                                                                                                                                                                                                                                                                            | —                                                                                               |
| `analytics`                 | `profile`                                                                                                                                                                                                                                                                                   | —                                                                                               |
| `communities` | `list`, `get`, `create`, `update`, `join`, `leave`, `read`, `send`, `report` | `list`, `get`, `read` |

Everything not listed as public requires a validated OAuth 2.1 bearer token.
Public reads are side-effect free.

## 2. Annotations (verified by tests)

| Tool                        | readOnly | destructive | openWorld | idempotent |
| --------------------------- | -------- | ----------- | --------- | ---------- |
| `universal_room`            | false    | false       | true      | false      |
| `public_room`               | false    | true        | true      | false      |
| `profile`                   | false    | true        | true      | false      |
| `followers_notifications`   | false    | true        | false     | false      |
| `likes`                     | false    | true        | false     | false      |
| `analytics`                 | true     | false       | false     | true       |
| `communities` | false    | true        | true      | false      |

## 3. Authentication

- Tokens are validated with `supabase.auth.getClaims(token)` (ES256).
- Checked claims: issuer, UUID `sub`, `exp`, non-empty `client_id`, `aud`
  containing the canonical resource, `room_resource` equal to it, and
  `room_scopes` covering `openid` and `profile`.
- Fail-closed: any missing or mismatching claim rejects the call with a
  RFC 9728 `WWW-Authenticate` challenge pointing at
  `https://crawler.today/.well-known/oauth-protected-resource/mcp`.
- Identity is `auth_user_hash` = HMAC(secret, `"auth:" + sub`). Raw subjects,
  emails and tokens are never stored.

## 4. Data contracts and minimisation

- Each tool publishes an `oneOf` output schema with one branch per action and
  `action` as a `const`.
- Every successful handler return is validated at runtime against the published
  schema and reduced to the declared fields (`src/lib/room/output.ts`).
- Internal UUIDs, account/owner ids, subject and auth hashes, storage paths,
  database errors and trace data are stripped at every nesting level.
- Errors never validate against the success schema: they return `isError: true`
  with a stable `{ error: { code, message } }` payload.

## 5. Retention

- Hard maximum: 24 hours for text and images in every room type, applied to
  reads and enforced on write paths.
- Additional rolling caps per room: newest 7 texts, newest 3 approved images.

## 6. Safety

- All user-generated content is treated as untrusted; the server instructions
  tell the model never to follow instructions found inside room content.
- Profile image fetches are SSRF-hardened (see `docs/threat-model.md`).
- Reporting exists in-product as an OAuth-only `report` action inside `universal_room`,
  `public_room`, `profile` and `communities`, plus the public `/support` form.
- A report never removes content automatically; a human resolves it
  (`received → reviewing → actioned | dismissed`). Reports are minimal (reason enum, optional
  details ≤ 500 chars) and return only an opaque receipt.
- Self-service `block` / `unblock` / `list_blocks`; blocks are mutual for personal rooms.
- Moderator access is a hashed server-side allowlist (`moderator_subjects`), never a public tool.

## 7. Public pages

`/privacy`, `/terms`, `/support`, `/safety`, `/data-deletion`, linked from the
footer of every public page.

## 8. Manual blockers before submission

2. OpenAI domain verification for `crawler.today`.
3. `ROOM_OAUTH_SIGNING_SECRET` configured for the self-hosted authorization
   server on `https://crawler.today` (no auth hook involved).
4. Anonymous sign-ins enabled in production — REQUIRED for the accountless consent screen.
5. Reviewer screenshots / screencast.
6. App directory portal metadata (name, icon, categories, descriptions).
7. At least one real moderator subject hash configured in `moderator_subjects`, with a named
   responsible person, review rhythm and escalation path.

`bun run release:check` reports each of these deterministically.
