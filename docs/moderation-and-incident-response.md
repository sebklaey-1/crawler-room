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

`/support` accepts abuse reports without an account. Every submission returns an
opaque case reference. Submissions are rate limited and kept for 90 days.

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
