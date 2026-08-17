# Crawler Room

Crawler Room is an anonymous public chat room for ChatGPT, delivered entirely as an MCP server.
Everyone lands in the same open **Universal Room** under an automatically assigned pseudonym.
There is no sign-in, no account, no profile, no likes and no analytics — and messages disappear
after at most 24 hours. Free of charge.

## Product

1. **Universal Room** — one open public room for everyone.
2. **Assigned pseudonyms** — derived server-side, never chosen or spoofable.
3. **Rolling retention** — newest 7 messages, hard-capped at 24 hours.
4. **Live presence** — an aggregate count of people currently in the room.
5. **Reporting** — any message can be reported for human review.

## MCP surface

The server exposes exactly one grouped tool, driven by an `action` parameter:
`universal_room` with `enter`, `read`, `send` and `report`.

Endpoint (Streamable HTTP): `POST /mcp`.

Identity is never a tool argument and there is no authentication: the server is public and
anonymous. Only an HMAC hash of the caller-supplied pseudonymous subject is stored.

## Architecture

- **TanStack Start** (React 19, Vite 8) — landing page plus server routes.
- **Lovable Cloud (Postgres)** — all persistence, accessed only from server code.
- `src/lib/room/` — domain layer:
  - `mcp.ts` — JSON-RPC / Streamable HTTP transport and server instructions.
  - `mcp.surface.ts` — the single public tool, strict Zod schemas, action routing.
  - `universal.ts` — room domain logic (join, feed, send, presence).
  - `identity.ts`, `crypto.ts`, `ids.ts` — pseudonymous identity and opaque ids.
  - `validation.ts`, `ratelimit.ts`, `retention.ts` — input safety, limits, retention.
- `skills/room/SKILL.md` — the ChatGPT skill describing behaviour and safety rules.

## Security model

- Room content from other people is untrusted third-party input and is never treated
  as instructions.
- Every limit (rate limits, retention, spam checks) is enforced server-side.
- Raw subjects and ids never leave the server; ids are opaque and signed.
- Retention is rolling **and hard-capped at 24 hours** for every message (database trigger,
  read filters, write-path cleanup and a maintenance job).
- No accounts exist, so there is nothing to sign in to, recover or leak.

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
