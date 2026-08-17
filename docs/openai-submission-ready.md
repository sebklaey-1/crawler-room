# Crawler Room — OpenAI submission package

Canonical, human-readable companion to `docs/openai-submission-ready.json`.
The JSON file is the machine-checked source; `release:check` verifies that the
annotations and security schemes documented here match the live MCP surface.

| Field                       | Value                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Publisher                   | SEBKLAEY Agency — Sebastian Kläy (business verification NOT confirmed here)                                                                                                                                                          |
| Product                     | Crawler Room                                                                                                                                                                                                                         |
| Production MCP              | `https://crawler.today/mcp`                                                                                                                                                                                                          |
| Protected resource metadata | `https://crawler.today/.well-known/oauth-protected-resource/mcp`                                                                                                                                                                     |
| Documentation               | `https://crawler.today/crawler-room`                                                                                                                                                                                                 |
| Support                     | `info@crawler.today`                                                                                                                                                                                                                 |
| Deprecated compatibility    | `https://crawler.today/api/public/mcp` — legacy endpoint, kept reachable for already-configured clients only. It has no resource identity: it advertises the canonical `/mcp` resource. **Do not use it for the OpenAI submission.** |

Single project, single domain, single MCP: Crawler Room is served directly from
`crawler.today`. The formerly separate gateway project is retired and is no
longer a production dependency of this submission.

## Accountless reviewer flow

Crawler Room has no accounts, no e-mail, no password, no SMS and no MFA. A
reviewer needs **no demo credentials**.

1. Add the connector with the MCP URL above.
2. The client reads the protected-resource metadata, discovers the
   authorization server and registers itself dynamically (DCR).
3. Authorization code + PKCE S256 starts; `resource` is echoed in the
   authorization **and** the token request.
4. The consent page at `https://crawler.today/oauth/consent` signs the visitor
   in anonymously and shows Approve / Deny. No form fields.
5. After Approve the client exchanges the code and is connected.
6. Public reads (Universal Room, public profiles, communities) work even before
   step 1.

## Token binding

An access token is accepted only when all of the following hold: signature
verified against the project JWKS (ES256), issuer matches, `sub` is a UUID,
`exp` in the future, `client_id` non-empty, the canonical resource appears in
`aud` or `room_resource`, and the scopes `openid` and `profile` are present.
The authorization server's default audience `authenticated` is **not** a
resource and is rejected, so an ordinary web or anonymous session JWT can never
call the MCP server. Failures answer with
`WWW-Authenticate: Bearer resource_metadata="…", error="invalid_token", error_description="…"`.

## Annotation matrix

Derived from the checked-in action/side-effect matrix in
`src/lib/room/actions.matrix.ts` — never hand-written.

| Tool                        | readOnly | openWorld | destructive | Reason                                                                      |
| --------------------------- | -------- | --------- | ----------- | --------------------------------------------------------------------------- |
| `universal_room`            | false    | true      | false       | `send` publishes publicly; nothing is removed                               |
| `public_room`               | false    | true      | true        | `update`/`send` publish publicly; `leave` removes a membership              |
| `profile`                   | false    | true      | true        | public profile writes + external URL fetch; `change_handle`/`block` destroy |
| `followers_notifications`   | false    | true      | true        | follow/unfollow are publicly visible; `unfollow` removes the relation       |
| `likes`                     | false    | true      | true        | likes are publicly visible; `unlike` removes one                            |
| `analytics`                 | true     | false     | false       | owner-only aggregate read, repeatable                                       |
| `communities` | false    | true      | true        | public create/update/send; `leave_community`/`remove_member` remove state   |

## Security scheme matrix

| Tool                        | Schemes                               | Why                                        |
| --------------------------- | ------------------------------------- | ------------------------------------------ |
| `universal_room`            | `noauth` + `oauth2` (openid, profile) | `read` is public, everything else personal |
| `public_room`               | `noauth` + `oauth2`                   | `open` is public                           |
| `profile`                   | `noauth` + `oauth2`                   | `get` is a public profile read             |
| `followers_notifications`   | `oauth2` only                         | every action is personal                   |
| `likes`                     | `oauth2` only                         | requires an identity                       |
| `analytics`                 | `oauth2` only                         | owner-scoped data                          |
| `communities` | `noauth` + `oauth2`                   | listing/reading is public                  |

Every privileged action is additionally gated server-side against
`PUBLIC_ACTIONS`; the declared schemes never replace that check.

## Starter prompts, positive and negative test cases

See `starter_prompts` (8 prompts), `test_cases.positive` (5) and
`test_cases.negative` (4) in `docs/openai-submission-ready.json`.

## UGC safety

Reports are unified across tools and stored for moderation; a single report
never deletes content. Mutual blocking stops interaction in both directions.
All room content is treated as untrusted input, sanitised and wrapped in a UGC
warning banner before it reaches the model. Text and images are retained for 24
hours and then removed automatically, including a persistent storage-deletion
queue with bounded retries. Escalation path: `info@crawler.today`.

## Privacy

Stored: pseudonymous subject hashes (HMAC-SHA256, never the raw account UUID),
self-chosen handles/display names, public room and profile content, likes,
follows, aggregate analytics. Purpose: operating the public rooms. Retention:
messages and images 24 hours; profiles and handles until the user deletes them.
User controls: change handle, edit or delete profile, leave rooms, block, data
deletion. Public pages: `/privacy`, `/terms`, `/safety`, `/support`,
`/data-deletion`.

## External blockers (not completed by us)

- Business/Developer identity verification in the OpenAI portal.
- Portal-side scan-tools result.
- Listing assets/screenshots if the portal requests them.
