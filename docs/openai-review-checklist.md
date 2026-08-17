# OpenAI review checklist — Crawler Room

Status document for the app-directory submission of Crawler Room. Nothing here claims
that an approval exists or is guaranteed; it records what the implementation
actually does today.

- Canonical MCP resource: `https://crawler.today/mcp`
- Canonical app origin: `https://crawler.today`
- Transport: Streamable HTTP (JSON and SSE), pull-only. No push, no WebSocket.

## 1. Tool surface — exactly seven tools

<!-- generated:tool-actions -->

| Tool | Actions | Public (no token) |
| ---- | ------- | ----------------- |
| `universal_room` | `enter`, `read`, `send`, `report` | `read` |
| `public_room` | `mine`, `open`, `update`, `leave`, `send`, `report` | `open` |
| `profile` | `get`, `update`, `change_handle`, `open_link`, `block`, `unblock`, `list_blocks`, `report` | `get` |
| `followers_notifications` | `follow`, `unfollow`, `list_followers`, `list_following`, `list_notifications`, `update_settings` | — |
| `likes` | `like`, `unlike` | — |
| `analytics` | `profile` | — |
| `communities` | `list`, `get`, `create`, `update`, `join`, `leave`, `read`, `send`, `report` | `list`, `get`, `read` |

<!-- /generated:tool-actions -->

Everything not listed as public requires a validated OAuth 2.1 bearer token.
Public reads are side-effect free.

## 2. Annotations (verified by tests)

<!-- generated:tool-annotations -->

| Tool | readOnlyHint | destructiveHint | openWorldHint | idempotentHint | Derivation |
| ---- | ------------ | --------------- | ------------- | -------------- | ---------- |
| `universal_room` | false | false | true | false | writes: `enter`, `send`, `report`; publicly visible: `send` |
| `public_room` | false | true | true | false | writes: `update`, `leave`, `send`, `report`; publicly visible: `update`, `send`; removes state: `leave` |
| `profile` | false | true | true | false | writes: `update`, `change_handle`, `open_link`, `block`, `unblock`, `report`; publicly visible: `update`, `change_handle`, `open_link`; removes state: `change_handle`, `block` |
| `followers_notifications` | false | true | true | false | writes: `follow`, `unfollow`, `update_settings`; publicly visible: `follow`, `unfollow`; removes state: `unfollow` |
| `likes` | false | true | true | false | writes: `like`, `unlike`; publicly visible: `like`, `unlike`; removes state: `unlike` |
| `analytics` | true | false | false | true | read-only, repeatable |
| `communities` | false | true | true | false | writes: `create`, `update`, `join`, `leave`, `send`, `report`; publicly visible: `create`, `update`, `join`, `leave`, `send`; removes state: `leave` |

<!-- /generated:tool-annotations -->

## 3. Authentication

- Tokens are issued and verified by the Crawler Room authorization server itself
  (HS256, server-side signing secret, single accepted `alg`, constant-time
  comparison). There is no external identity provider and no auth hook.
- Checked claims: issuer, non-empty `sub`, `exp`, non-empty `client_id`, `aud`
  containing the canonical resource, `room_resource` equal to it, and
  `room_scopes` covering `openid` and `profile`.
- Fail-closed: any missing or mismatching claim rejects the call with a
  RFC 9728 `WWW-Authenticate` challenge pointing at
  `https://crawler.today/.well-known/oauth-protected-resource/mcp`.
- Identity is `auth_user_hash` = HMAC(secret, `"auth:" + sub`) and is anchored in
  `identity_anchors`, so a profile survives browser session resets. Raw subjects,
  e-mail addresses and tokens are never stored.

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
