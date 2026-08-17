# Crawler Room — consolidated implementation status

**Date:** 2026-08-16 (UTC)
**Baseline commit:** `4d1ccb067bdc7ec69f39e0424ac3c67b47313cbc` (OAuth/MCP auth phase 1A)
**HEAD at audit time:** `53071857803360850fe87cb434cb2d69f03320c4` (+ this closing audit commit)
**Deployment status: NOT deployed.** No publish, no production write, no user data deleted.

## 1. Change overview

147 commits since the baseline. Named milestones:

| Commit    | Milestone                                     |
| --------- | --------------------------------------------- |
| `1bc4a9a` | Canonical domain `crawler.today` + app icon   |
| `2bd0271` | Phase 1B technical fix (getClaims, hash-only) |
| `4945e7c` | Phase 1D mandatory public pages               |
| `9f63d3f` | Phase 1D.1 documentation audit                |
| `c154819` | Canonical resource switch                     |
| `b7c7bc9` | Phase 2 review hardening                      |
| `5307185` | Phase 3 safety: reports, blocks, UGC guard    |

Working tree at audit start: clean, no leftovers from an interrupted run. No duplicate
migrations, no duplicate routes, no second consent component
(`src/components/oauth-consent.tsx` is the only one; `/[.]lovable.oauth.consent` is a pure
redirect to `/oauth/consent`). The authorization-server proxy route
(`[.]well-known.oauth-authorization-server.ts`) was removed and is absent from
`src/routeTree.gen.ts`.

Files changed since baseline: 75 (source, routes, docs, scripts, migrations).

### Migrations since baseline

| File               | Content                                                     |
| ------------------ | ----------------------------------------------------------- |
| `20260816173415_…` | drop `auth_user_id`, introduce `auth_user_hash` (hash-only) |
| `20260816174957_…` | `custom_access_token_hook` → `https://crawler.today/mcp`    |
| `20260816180514_…` | `support_requests`, `privacy_requests` + grants/RLS         |
| `20260816182006_…` | retention hard cap (24 h) across all room types             |
| `20260816185204_…` | `content_reports`, `moderator_subjects`, `profile_blocks`   |

`20260816171442_…` (pre-hook, adds `auth_user_id`) is superseded by `20260816173415_…`;
it is retained for migration history only and the column no longer exists.

## 2. Invariants — verified

- **Exactly seven public tools** (live `tools/list`): `universal_room`, `public_room`,
  `profile`, `followers_notifications`, `likes`, `analytics`, `communities`.
- **Canonical resource** `https://crawler.today/mcp` in code, metadata, hook and docs.
- **Protected-resource URL** `https://crawler.today/.well-known/oauth-protected-resource/mcp`
  in the metadata document and in every `WWW-Authenticate` challenge.
- **No production derivation from host/origin.** Local derivation is guarded by
  `process.env.NODE_ENV === "test"` only (`src/lib/room/auth.ts`, `src/lib/room/mcp.ts`).
- **No legacy resource.** Remaining `zinga-room` strings are exclusively: a negative test
  fixture (`auth.test.ts`), two documentation guards (`docs.test.ts`,
  `verify-production-domain.ts`, `release-checklist.md`) and the superseded historic
  migration. The preview domain appears nowhere as a canonical resource.
- **No raw identifiers.** No Supabase auth UUID, access token, e-mail address or raw IP in
  `content_reports`, `privacy_requests`, `support_requests`, `profile_blocks` or in logs;
  only keyed HMAC-SHA256 pseudonyms, with the support pseudonym expiring after 24 h.
- **`openai/subject` authorises and migrates nothing** — it is read as `_meta` context only;
  guarded by `surface.test.ts`.

## 3. Build and schema consistency

- Route tree regenerated, no stale routes.
- Generated Supabase types match the applied migrations.
- Input JSON Schemas are derived from the Zod discriminated unions
  (`src/lib/room/schema.ts`); output JSON Schemas are enforced at runtime by
  `src/lib/room/output.ts` (`oneOf` branches, `additionalProperties: false`, forbidden
  fields stripped, generic `INTERNAL_ERROR` on violation).
- The report / block actions are present in schemas, the `PUBLIC_ACTIONS` policy map (all
  `report`, `block`, `unblock`, `list_blocks` are OAuth-only), summaries, `SKILL.md`,
  submission dossier, reviewer test plan and tests.
- Annotations remain conservative (`readOnlyHint` only for genuine reads,
  `destructiveHint: false`, `openWorldHint: true`).
- Legal, safety and support pages render only real values and publish the confirmed
  public contact `info@crawler.today` (canonical in `src/lib/room/legal.ts`).

## 4. Security controls

| Control                | State                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Token verification     | `supabase.auth.getClaims(token)`, ES256, audience/resource bound, timeout, fail-closed                                           |
| Test stubs             | `x-room-test-user` / `Test-AuthContext` only when `NODE_ENV=test`, otherwise `INTERNAL_ERROR`                                    |
| Access tokens          | self-issued HS256 JWTs from `https://crawler.today`; no Supabase auth hook in any runtime path                                   |
| SSRF                   | central `src/lib/room/ssrf.ts`: HTTPS only, private/loopback/link-local blocked, ≤3 redirects, timeout, size cap, MIME allowlist |
| Reports                | service-role only, rate limited per reporter and per target, idempotent, never an automatic sanction                             |
| Blocks                 | mutual for personal rooms, self-service, no content deletion                                                                     |
| Data rights            | hash-only, idempotent per open request, owner-scoped, nothing deleted automatically                                              |
| Logs / health / errors | tool, action, status, opaque request id only; health returns no environment details                                              |

Targeted grep review of `console.log`, `authorization`, `access_token`, `auth_user_id`,
`openai/subject`, `owner_account_id`, `subject_hash`, `storage_path` in model-visible
response paths: every hit is internal, server-side use (DB filters, HMAC inputs, signed
URL creation) or a CLI script printing its own results. No leak into MCP output, page
output or logs.

## 5. Test matrix (this run)

| Gate                                  | Result                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prettier                              | 10 files reformatted, now clean                                                                                                                                                                                                                   |
| `bun run typecheck`                   | pass, 0 errors                                                                                                                                                                                                                                    |
| ESLint (files changed since baseline) | 0 `no-control-regex` (4 intentional sanitisers annotated); remaining repo-wide findings are 233 pre-existing `@typescript-eslint/no-explicit-any` on DB row mappings and 6 `react-refresh/only-export-components` — style, not technical failures |
| `bunx vitest run`                     | **162 passed / 162**, 10 files                                                                                                                                                                                                                    |
| `bun run build`                       | pass (client + nitro)                                                                                                                                                                                                                             |
| `bun run release:check`               | **26 / 29**, blocked by 3 operational items (below)                                                                                                                                                                                               |

### MCP smoke (local)

`initialize` ok · `tools/list` returns exactly the seven names · public read
(`communities list`) HTTP 200 · protected action without a token
HTTP 401 + `WWW-Authenticate: Bearer resource_metadata="https://crawler.today/.well-known/oauth-protected-resource/mcp"`
· malformed JSON-RPC → `-32600` · batch isolation ok (one entry succeeds while the other
fails independently) · authenticated read path covered by `auth.test.ts` under
`NODE_ENV=test` (the dev server correctly refuses the test header).

### Route smoke (local)

`/.well-known/oauth-protected-resource` 200 (correct resource + authorization server) ·
`/oauth/consent` 200 · `/privacy` 200 · `/terms` 200 · `/support` 200 · `/safety` 200 ·
`/data-deletion` 200 · `/api/public/health` 200 (`status`, `service`, `version`,
`dependencies` only).

No production writes, reports, blocks or data-rights requests were created.

## 6. Remaining manual / operational blockers

1. `ROOM_MCP_RESOURCE` not set in the production environment (code defaults to the
   canonical value; the explicit setting is the release gate).
2. Moderator identity/role: at least one real subject hash in `moderator_subjects`, a named
   responsible person, review rhythm and escalation path (`ROOM_MODERATION_OWNER`).
3. `ROOM_OAUTH_SIGNING_SECRET` set in the production environment.
4. Anonymous sign-ins enabled in production — REQUIRED for the accountless consent screen.
5. OpenAI domain and developer verification for `crawler.today`.
6. Reviewer assets: screenshots / screencast and the walked-through test run.
7. App directory portal metadata.

While these are open, no approval, production readiness or launch clearance is claimed.

## 7. Conclusion

The branch is internally consistent: one tool surface, one canonical resource, one consent
component, no duplicate migrations or routes, and no contradictory environment names. All
automated gates pass; the only remaining `release:check` blocks are operational. **The
application is not deployed.**
