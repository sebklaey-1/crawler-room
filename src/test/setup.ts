/** Deterministic secrets for hashing/id encoding in tests — never real values. */
process.env["SUBJECT_HASH_SECRET"] ??= "test-subject-secret";
process.env["MESSAGE_ID_SECRET"] ??= "test-message-secret";
