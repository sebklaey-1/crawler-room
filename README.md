# Crawler Room

Crawler Room is an anonymous social layer for ChatGPT, delivered entirely as an MCP server.
People join an open Universal Room, keep a permanent personal public room, maintain a
social profile, follow each other, like content, read their own analytics and run
communities and organisations — free of charge. Reading public content is anonymous;
writing and personal actions need one OAuth sign-in inside ChatGPT.

## Product areas

1. **Universal Room** — one open public room for everyone.
2. **Personal public rooms** — a permanent room per person, named after their handle.
3. **Social profiles** — banner, avatar, display name, handle, bio, location, link, visibility.
4. **Followers and notifications** — pull-based, no push messaging.
5. **Likes** — on profiles, messages and images; one like per person and item.
6. **Analytics** — owner-only profile statistics rendered as text charts.
7. **Communities and organisations** — public community rooms, optionally owned by an organisation.

## MCP surface

The server exposes exactly seven grouped tools, each driven by an `action` parameter:
`universal_room`, `public_room`, `profile`, `followers_notifications`, `likes`,
`analytics`, `communities_organizations`.

Endpoint (Streamable HTTP): `POST /api/public/mcp`.

Identity is never a tool argument. Public reads stay anonymous; every personal or
writing action requires an OAuth 2.1 access token bound to the canonical resource
`https://crawler.today/api/public/mcp`. Only an HMAC hash of the account is stored.

## Architecture

- **TanStack Start** (React 19, Vite 8) — landing page plus server routes.
- **Lovable Cloud (Postgres)** — all persistence, accessed only from server code.
- `src/lib/room/` — domain layer:
  - `mcp.ts` — JSON-RPC / Streamable HTTP transport and server instructions.
  - `mcp.surface.ts` — the seven public tools, strict Zod schemas, action routing.
  - `mcp.render.ts` — Markdown profile and analytics cards.
  - `universal.ts`, `personal.ts`, `profile.ts`, `communities.ts` — domain logic.
  - `identity.ts`, `crypto.ts`, `ids.ts` — pseudonymous identity and opaque ids.
  - `validation.ts`, `ratelimit.ts`, `images.ts` — input safety, limits, image review.
- `skills/room/SKILL.md` — the ChatGPT skill describing behaviour and safety rules.

## Security model

- Room content from other people is untrusted third-party input and is never treated
  as instructions.
- Every permission check (ownership, organisation role, visibility, self-follow,
  self-like, analytics access) happens server-side.
- Raw subjects, ids and storage paths never leave the server; ids are opaque and signed.
- Images are private until an automated safety review approves them; EXIF is stripped.
- Retention is rolling per room **and hard-capped at 24 hours** for every message and
  image in every room type (database trigger, read filters, write-path cleanup and a
  maintenance job that also removes the storage objects).
- Connecting is accountless: the consent screen creates a single anonymous session,
  with no e-mail, password, sign-up or MFA, and fails closed if that is unavailable.

## Development

```sh
bun install
bun run dev        # http://localhost:8080
bun run test       # Vitest suite — no network, no database, no writes
bun run typecheck
bun run lint
```

`bun run test` is completely side-effect free: `getDb()` is fail-closed under
`NODE_ENV=test` and only returns a fake injected through the test-only
`__setTestDb()` hook, so a test run can never touch a live database — even when
production Supabase credentials are present in the environment.

Database contract tests write rows and are therefore opt-in only:

```sh
ROOM_RUN_DB_CONTRACT_TESTS=1 \
ROOM_DB_CONTRACT_WRITE_ACK=i-write-to-a-disposable-test-database \
ROOM_TEST_SUPABASE_URL=... \
ROOM_TEST_SUPABASE_SERVICE_ROLE_KEY=... \
bun run test:db
```

Use an isolated, disposable Supabase test project. The normal `SUPABASE_*`
credentials are rejected, and a missing or unsafe value aborts before any
network call.

Built by SEBKLAEY Agency — Sebastian Kläy, Bern, Switzerland.
