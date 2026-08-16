import { beforeAll, describe, expect, it } from "vitest";

import {
  MAX_SUPPORT_BODY_BYTES,
  SUPPORT_CATEGORIES,
  caseReference,
  requesterHash,
  submitDeletionRequest,
  submitSupportRequest,
  supportRequestSchema,
} from "./support";
import type { Db } from "./store";

beforeAll(() => {
  process.env["SUBJECT_HASH_SECRET"] ??= "test-subject-secret";
});

/** Minimal fake of the parts of the Supabase client the support module uses. */
function fakeDb(options: { rateRows?: number; openDeletion?: string | null } = {}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = new Proxy(chain, {
        get(_t, prop: string) {
          if (prop === "insert") {
            return (row: Record<string, unknown>) => {
              inserts.push({ table, row });
              return Promise.resolve({ error: null });
            };
          }
          if (prop === "maybeSingle") {
            return () =>
              Promise.resolve({
                data: options.openDeletion ? { reference: options.openDeletion } : null,
                error: null,
              });
          }
          if (prop === "then") {
            // awaiting the select chain resolves to rate-limit rows
            return (resolve: (value: unknown) => unknown) =>
              resolve({
                data: Array.from({ length: options.rateRows ?? 0 }, () => ({
                  created_at: new Date().toISOString(),
                })),
                error: null,
              });
          }
          return () => self;
        },
      });
      return self;
    },
  } as unknown as Db;
  return { db, inserts };
}

describe("support request validation", () => {
  it("accepts a well-formed abuse report", () => {
    const parsed = supportRequestSchema.safeParse({
      category: "abuse",
      subject: "Harassment in a room",
      message: "A profile keeps sending threats in the universal room.",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown categories, short subjects and short messages", () => {
    expect(
      supportRequestSchema.safeParse({ category: "nope", subject: "abcd", message: "x".repeat(30) })
        .success,
    ).toBe(false);
    expect(
      supportRequestSchema.safeParse({ category: "other", subject: "ab", message: "x".repeat(30) })
        .success,
    ).toBe(false);
    expect(
      supportRequestSchema.safeParse({ category: "other", subject: "abcd", message: "short" })
        .success,
    ).toBe(false);
  });

  it("exposes the documented categories and a hard body ceiling", () => {
    expect([...SUPPORT_CATEGORIES]).toEqual(["technical", "account", "privacy", "abuse", "other"]);
    expect(MAX_SUPPORT_BODY_BYTES).toBe(16 * 1024);
  });
});

describe("case references and requester hashing", () => {
  it("produces opaque, non-enumerable references", () => {
    const a = caseReference();
    const b = caseReference();
    expect(a).toMatch(/^RC-[0-9A-Z]{6,}$/);
    expect(a).not.toBe(b);
  });

  it("hashes request metadata deterministically and never stores it raw", async () => {
    const hash = await requesterHash("203.0.113.7");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("203.0.113.7");
    expect(await requesterHash("203.0.113.7")).toBe(hash);
    expect(await requesterHash(null)).toBeNull();
  });
});

describe("submitSupportRequest", () => {
  it("stores a validated report without the raw fingerprint", async () => {
    const { db, inserts } = fakeDb();
    const result = await submitSupportRequest(
      db,
      {
        category: "abuse",
        subject: "Harassment",
        message: "This profile keeps posting threats at me in a public room.",
        handle: "@someone",
      },
      { requestFingerprint: "203.0.113.7" },
    );
    expect(result.received).toBe(true);
    const stored = inserts.find((entry) => entry.table === "support_requests");
    expect(stored?.row["public_target"]).toBe("someone");
    expect(JSON.stringify(stored?.row)).not.toContain("203.0.113.7");
  });

  it("silently drops honeypot submissions without writing", async () => {
    const { db, inserts } = fakeDb();
    const result = await submitSupportRequest(db, {
      category: "other",
      subject: "Spam bot",
      message: "x".repeat(40),
      website: "http://spam.example",
    });
    expect(result.received).toBe(true);
    expect(inserts.filter((entry) => entry.table === "support_requests")).toHaveLength(0);
  });

  it("rate limits after five submissions per hour", async () => {
    const { db } = fakeDb({ rateRows: 5 });
    await expect(
      submitSupportRequest(
        db,
        { category: "other", subject: "Again", message: "x".repeat(40) },
        { requestFingerprint: "203.0.113.9" },
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("rejects invalid input", async () => {
    const { db } = fakeDb();
    await expect(submitSupportRequest(db, { category: "abuse" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

describe("submitDeletionRequest", () => {
  const hash = "a".repeat(64);

  it("records a pending, auditable request", async () => {
    const { db, inserts } = fakeDb({ openDeletion: null });
    const result = await submitDeletionRequest(db, hash, "please remove my profile");
    expect(result.status).toBe("pending");
    expect(result.duplicate).toBe(false);
    expect(inserts.find((entry) => entry.table === "privacy_requests")?.row["request_type"]).toBe(
      "deletion",
    );
  });

  it("reuses the open request instead of creating duplicates", async () => {
    const { db, inserts } = fakeDb({ openDeletion: "RC-ABC123" });
    const result = await submitDeletionRequest(db, hash);
    expect(result).toEqual({ reference: "RC-ABC123", status: "pending", duplicate: true });
    expect(inserts.filter((entry) => entry.table === "privacy_requests")).toHaveLength(0);
  });

  it("refuses anything that is not a keyed account hash", async () => {
    const { db } = fakeDb();
    await expect(submitDeletionRequest(db, "user@example.com")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});
