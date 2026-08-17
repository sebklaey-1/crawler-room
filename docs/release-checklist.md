# Release checklist — Crawler Room

Run `bun run release:check`. It is deterministic, prints no secret values and
exits non-zero while a blocker remains. The production domain check is a
separate manual step: `bun run verify:domain` (optionally `--rpc`). Automated
tests never make external network calls.

## Automated gates (`bun run release:check`)

- [ ] Canonical resource `https://crawler.today/api/public/mcp` pinned in the auth layer
- [ ] Exactly seven public tools, each with explicit annotations
- [ ] Runtime output contract enforcement wired into the MCP layer
- [ ] `/privacy`, `/terms`, `/support`, `/safety`, `/data-deletion` routes present
- [ ] All review documents present
- [ ] No legacy `zinga-room` string in active code or docs
- [ ] No "no login" or "everything can be reported" claim on the landing page
- [ ] `ROOM_MCP_RESOURCE`, `SUBJECT_HASH_SECRET`, `MESSAGE_ID_SECRET`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` present
- [ ] public support contact `info@crawler.today` canonical in `src/lib/room/legal.ts`

## Quality gates

- [ ] `bun run typecheck`
- [ ] `bun run lint` on changed files
- [ ] `bun run test` (offline; no external requests)
- [ ] `bun run build`

## Custom domain ownership and routing verified — HARD BLOCKER

Target architecture (since 2026-08-17): **one project, one domain, one MCP.**
`crawler.today` and `www.crawler.today` point directly at this Crawler Room
project; the former separate Crawler/Crawler-Social gateway project is
decommissioned and is no longer a prerequisite of any gate. Historical notes
about a split setup are migration history only.

- [ ] `crawler.today` **and** `www.crawler.today` are attached to this Crawler Room
      project in Project Settings → Domains and both report **Active**.
      Verified on 2026-08-17: both domains are active on this project.
- [ ] DNS: A records for `@` and `www` point at the Lovable address, the
      `_lovable` TXT verification record resolves, and no stale records from a
      previous project remain. CAA records, if any, must permit Let's Encrypt.
- [ ] TLS: certificates issued for both hostnames; `https://crawler.today`
      answers without a certificate warning and does not redirect off-domain.
- [ ] `https://crawler.today/crawler-room` returns 200 from this project
      (documentation alias, `resource_documentation`, no redirect).
- [ ] `bun run verify:domain` reports the metadata, consent and health routes
      from the same deployment. Exit code 2 means "not deployed yet", exit code
      1 means a real misconfiguration and blocks the release.
- [ ] `bun run verify:domain --rpc` returns exactly the seven public tool names.

### Dependent steps — only after the domain assignment is confirmed

- [ ] OpenAI portal domain verification for `crawler.today` completed.
- [ ] Supabase Site URL set to `https://crawler.today`.
- [ ] Supabase redirect allow list contains the ChatGPT OAuth callback and
      `https://crawler.today/oauth/consent`.
- [ ] Custom access token hook enabled, issuing `aud` and `room_resource`
      bound to `https://crawler.today/api/public/mcp`. Activate this in
      production **only** after the domain assignment above is confirmed —
      switching the claim earlier invalidates every live token and breaks the
      connector.

## Remaining manual blockers

Run `bun run release:check:submit` to see the current state of this list. That
script reports **only** external/manual items and never prints a secret value.
`bun run release:check` covers everything verifiable from the repository and
must be 100 % green (exit 0) on its own.

The named public moderation owner (`SEBKLAEY Agency — Sebastian Kläy`) is
canonical in `src/lib/room/legal.ts`. The real moderator subject hash is
configured in `moderator_subjects` only and never appears in code, migrations
or logs.

2. OpenAI domain verification for `crawler.today`.
3. ChatGPT OAuth callback URL in the Supabase redirect allow list.
4. Custom access token hook enabled in production.
5. Anonymous sign-ins enabled in production — REQUIRED for the accountless
   consent screen; a disabled setting blocks the release.
6. Reviewer screenshots / screencast.
7. App directory portal metadata.
8. Moderation staffing: a named responsible person, at least one configured moderator subject
   hash in `moderator_subjects`, a documented review rhythm and an escalation path.

No statement in this repository claims that an OpenAI approval exists or is
guaranteed.
