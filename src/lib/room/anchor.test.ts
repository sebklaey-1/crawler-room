/**
 * Regression tests for the durable identity anchor.
 *
 * These reproduce the reported production failure: a handle/profile change was
 * confirmed, then a later connection came back as a different, freshly seeded
 * identity because the subject was derived from a recycled anonymous browser
 * session. With an anchor the subject must stay byte-identical across new
 * sessions, process restarts and concurrent binds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANCHOR_COOKIE,
  anchorCookie,
  bindAnchor,
  newAnchorToken,
  readCookie,
  resolveAnchoredSubject,
  subjectForAnchor,
} from "./anchor";
import type { Db } from "./store";

vi.mock("./config", () => ({ requireSecret: () => "test-secret" }));

/** In-memory stand-in for `public.identity_anchors`. */
function fakeDb(rows = new Map<string, string>()) {
  const db = {
    rows,
    from(table: string) {
      if (table !== "identity_anchors") throw new Error(`unexpected table ${table}`);
      let key: string | null = null;
      const api = {
        select: () => api,
        eq: (_column: string, value: string) => {
          key = value;
          return api;
        },
        maybeSingle: async () => {
          const subject = key ? rows.get(key) : undefined;
          return { data: subject ? { subject_hash: subject } : null, error: null };
        },
        update: () => api,
        upsert: async (row: { anchor_hash: string; subject_hash: string }) => {
          // first write wins, exactly like ON CONFLICT DO NOTHING semantics
          if (!rows.has(row.anchor_hash)) rows.set(row.anchor_hash, row.subject_hash);
          return { error: null };
        },
      };
      return api;
    },
  };
  return db as unknown as Db & { rows: Map<string, string> };
}

describe("identity anchor", () => {
  let db: ReturnType<typeof fakeDb>;

  beforeEach(() => {
    db = fakeDb();
  });

  it("parses only the exact cookie name", () => {
    expect(readCookie(`other=1; ${ANCHOR_COOKIE}=abc; x=2`, ANCHOR_COOKIE)).toBe("abc");
    expect(readCookie(`not_${ANCHOR_COOKIE}=abc`, ANCHOR_COOKIE)).toBeNull();
    expect(readCookie(null, ANCHOR_COOKIE)).toBeNull();
  });

  it("issues a hardened, long-lived cookie", () => {
    const cookie = anchorCookie(newAnchorToken());
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });

  it("never invents an identity without a verified session subject", async () => {
    expect(await resolveAnchoredSubject(null, null, db)).toBeNull();
    expect(await resolveAnchoredSubject(`${ANCHOR_COOKIE}=unknown`, null, db)).toBeNull();
  });

  it("keeps the same subject across a brand new browser session", async () => {
    const first = await resolveAnchoredSubject(null, "subject-A", db);
    expect(first?.setCookie).toBeTruthy();
    const token = /cr_anchor=([0-9a-f]{64})/.exec(first!.setCookie!)![1];

    // new ChatGPT session -> new anonymous account -> different session subject
    const second = await resolveAnchoredSubject(`${ANCHOR_COOKIE}=${token}`, "subject-B", db);
    expect(second?.subjectHash).toBe(first?.subjectHash);
    expect(second?.subjectHash).toBe("subject-A");
    expect(second?.setCookie).toBeNull();
  });

  it("survives a process restart because state lives in the database", async () => {
    const token = newAnchorToken();
    await bindAnchor(token, "subject-A", db);
    // simulate a restart: fresh module state, same persisted rows
    const restarted = fakeDb(db.rows);
    expect(await subjectForAnchor(token, restarted)).toBe("subject-A");
  });

  it("collapses concurrent binds of one token onto a single identity", async () => {
    const token = newAnchorToken();
    const results = await Promise.all([
      bindAnchor(token, "subject-A", db),
      bindAnchor(token, "subject-B", db),
    ]);
    expect(new Set(results).size).toBe(1);
  });

  it("rejects malformed anchor tokens instead of trusting them", async () => {
    expect(await subjectForAnchor("../../etc/passwd", db)).toBeNull();
    expect(await subjectForAnchor("", db)).toBeNull();
    await expect(bindAnchor("nope", "subject-A", db)).rejects.toThrow();
  });
});
