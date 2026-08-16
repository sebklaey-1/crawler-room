# Release checklist — @room

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
- [ ] `VITE_PUBLIC_SUPPORT_EMAIL` present

## Quality gates

- [ ] `bun run typecheck`
- [ ] `bun run lint` on changed files
- [ ] `bun run test` (offline; no external requests)
- [ ] `bun run build`

## Custom domain ownership and routing verified — HARD BLOCKER

The canonical resource is only valid if `crawler.today` is served by _this_
project. Confirm all of the following before enabling anything that binds to
the domain:

- [ ] `crawler.today` **and** `www.crawler.today` are attached to this Room Chat
      project in Project Settings → Domains and both report **Active**.
      Verified on 2026-08-16: both domains are active on this project.
- [ ] DNS: A records for `@` and `www` point at the Lovable address, the
      `_lovable` TXT verification record resolves, and no stale records from a
      previous project remain. CAA records, if any, must permit Let's Encrypt.
- [ ] TLS: certificates issued for both hostnames; `https://crawler.today`
      answers without a certificate warning and does not redirect off-domain.
- [ ] `bun run verify:domain` reports the metadata, consent and health routes
      from the same deployment. Exit code 2 means "not deployed yet", exit code
      1 means a real misconfiguration and blocks the release.
- [ ] `bun run verify:domain --rpc` returns exactly the seven public tool names.
- [ ] If the domain is attached to a different project, or ownership cannot be
      verified with certainty: **do not move it, do not deploy.** Record it here
      as an open blocker instead. Never overwrite an existing crawler.today
      production app.

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

1. Public support contact (`VITE_PUBLIC_SUPPORT_EMAIL`) is not configured.
2. OpenAI domain verification for `crawler.today`.
3. ChatGPT OAuth callback URL in the Supabase redirect allow list.
4. Custom access token hook enabled in production.
5. Decision recorded on anonymous sign-in for the consent screen.
6. Reviewer screenshots / screencast.
7. App directory portal metadata.
8. Moderation staffing: a named responsible person, at least one configured moderator subject
   hash in `moderator_subjects`, a documented review rhythm and an escalation path.

No statement in this repository claims that an OpenAI approval exists or is
guaranteed.
