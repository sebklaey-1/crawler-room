# Moderation and incident response — @room

## Content rules

Public rooms, communities and profiles must not contain illegal content,
harassment, sexual content involving minors, personal data of other people,
malware or spam. `/safety` states the same rules publicly.

## Automatic controls

- Images pass a review step before they become visible and are re-encoded
  without metadata.
- Message rate limits per identity and per hour.
- Link limits per message.
- Hard 24-hour retention plus rolling per-room caps, so content does not
  accumulate.
- Blocking: `profile action=block` hides a profile from the caller.

## Reporting

Two intake paths lead into the same human queue:

1. **In-product (OAuth required).** `universal_room / report`, `public_room / report`,
   `profile / report` and `communities_organizations / report`. The reporter identity is the
   existing pseudonymous `subjectHash`; the raw auth subject is never stored. Input is a closed
   reason enum plus optional details (trimmed, max 500 characters). Targets are resolved
   server-side, so invented ids and cross-room targets are refused, self-reports are blocked and
   a second open report of the same target by the same person is answered idempotently. Reports
   are rate limited per reporter and per target. The public response contains only `reported`,
   `already_reported`, `status` and an opaque receipt.
2. **Web form.** `/support` accepts abuse reports without an account and returns an opaque case
   reference. Submissions are rate limited and kept for 90 days.

A report never removes, hides or restricts content automatically. Status flow:
`received → reviewing → actioned | dismissed`, with internal audit timestamps. Reports live in
`public.content_reports` with a short tamper-evident snapshot hash instead of a full copy of the
content; the table is service-role only and RLS-closed.

## Blocking

`profile / block`, `profile / unblock` and `profile / list_blocks` are self-service. A block is
mutual for personal rooms: neither side can open, send into or follow the other person's room,
and the profile view is refused. It does not delete published content and does not affect the
Universal Room or community rooms. `list_blocks` returns @handles and display names only.

## Moderator access

Privileged operations (`listPendingReports`, `resolveReport`) are server-side functions and are
**not** exposed as MCP tools. Authorisation uses the `public.moderator_subjects` allowlist, which
stores hashed Supabase auth subjects only — no e-mail addresses and no UUIDs in source code.
Review happens through the secured internal process; there is no semi-protected web console.
Logs and API responses never contain reported text, URLs, reporter/target hashes or tokens.

**Release blocker:** at least one real moderator subject hash must be present in
`moderator_subjects`, with a named responsible person, a documented review rhythm (working-day
triage) and an escalation path. `bun run release:check` reports this deterministically.

## Triage

| Severity | Examples                           | Target reaction                                                                                  |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| Critical | CSAM, credible threat, doxxing     | remove content immediately, preserve the case record, contact authorities where legally required |
| High     | targeted harassment, malware links | remove content, restrict the identity                                                            |
| Normal   | spam, off-topic flooding           | remove content, tighten rate limits                                                              |
| Low      | disputes, feature complaints       | answer through the case reference                                                                |

Deletion is performed against the content row and, for images, the storage
object. Retention means most reported content expires within 24 hours anyway;
the case record survives so a pattern remains visible.

## Security incidents

1. Contain: disable the affected action or rotate the affected secret
   (`SUBJECT_HASH_SECRET`, `MESSAGE_ID_SECRET`, Supabase keys).
2. Assess: which pseudonymous data was reachable, for how long.
3. Notify: inform affected users through the public pages when personal data was
   exposed, plus any legally required notification.
4. Fix and record: add a regression test before reopening the action.

## Contact

Public form at `/support`. A public email address is configured through
`VITE_PUBLIC_SUPPORT_EMAIL`; while it is unset the pages show a neutral notice
and `bun run release:check` reports a blocker.
