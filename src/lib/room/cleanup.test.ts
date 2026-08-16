/**
 * Persistent storage-deletion queue, retry behaviour and cleanup authorization.
 * Everything runs against an in-memory stub — no database, no network.
 */
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "./crypto";
import {
  deleteImageRow,
  processDeletionQueue,
  removeStorageObjects,
  storageVariants,
} from "./imagestore";
import { authorizeCleanup, CLEANUP_TOKEN_NAME } from "./maintenance";
import type { Db } from "./store";

interface StubOptions {
  /** Storage paths whose removal fails, with the reported status code. */
  failing?: Record<string, string>;
  /** Rows returned by `due_storage_deletions`. */
  due?: string[];
  /** SHA-256 digest registered for the cleanup token. */
  tokenHash?: string;
}

function stubDb(options: StubOptions = {}) {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const removed: string[][] = [];
  const deletedRows: number[] = [];
  const order: string[] = [];

  const db = {
    rpcCalls,
    removed,
    deletedRows,
    order,
    async rpc(name: string, args?: unknown) {
      rpcCalls.push({ name, args });
      order.push(`rpc:${name}`);
      if (name === "due_storage_deletions") {
        return { data: (options.due ?? []).map((storage_path) => ({ storage_path })), error: null };
      }
      return { data: null, error: null };
    },
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: (_column: string, value: unknown) => {
          if (table === "image_messages") deletedRows.push(Number(value));
          return chain;
        },
        delete: () => {
          order.push("row:delete");
          return chain;
        },
        maybeSingle: async () =>
          table === "internal_secret_hashes"
            ? { data: options.tokenHash ? { sha256: options.tokenHash } : null, error: null }
            : { data: null, error: null },
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ error: null }).then(resolve),
      };
      return chain;
    },
    storage: {
      from() {
        return {
          async remove(paths: string[]) {
            removed.push(paths);
            order.push("storage:remove");
            const hit = paths.find((path) => options.failing?.[path]);
            return hit
              ? { data: null, error: { statusCode: options.failing?.[hit], message: "nope" } }
              : { data: null, error: null };
          },
        };
      },
    },
  };
  return db as unknown as Db & typeof db;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env["ADMIN_TOKEN"];
});

describe("storage deletion queue", () => {
  it("queues the storage path before the image row is deleted", async () => {
    const db = stubDb();
    await deleteImageRow(db, { id: 42, storage_path: "room/a.jpg" });
    const queueIndex = db.order.indexOf("rpc:queue_storage_deletion");
    expect(queueIndex).toBeGreaterThanOrEqual(0);
    expect(queueIndex).toBeLessThan(db.order.indexOf("row:delete"));
    expect(db.deletedRows).toEqual([42]);
  });

  it("clears the queue entry after a successful removal", async () => {
    const db = stubDb();
    const result = await removeStorageObjects(db, ["room/a.jpg"]);
    expect(result.failed).toEqual([]);
    expect(db.rpcCalls.map((call) => call.name)).toContain("complete_storage_deletion");
    expect(db.rpcCalls.map((call) => call.name)).not.toContain("fail_storage_deletion");
  });

  it("keeps a failing path queued with a safe error category", async () => {
    const db = stubDb({ failing: { "room/bad.jpg": "500" } });
    const result = await removeStorageObjects(db, ["room/bad.jpg"]);
    expect(result.failed).toEqual(["room/bad.jpg"]);
    expect(result.errorCategory).toBe("upstream_error");
    const fail = db.rpcCalls.find((call) => call.name === "fail_storage_deletion");
    expect(fail?.args).toMatchObject({
      p_paths: ["room/bad.jpg"],
      p_category: "upstream_error",
    });
    expect(JSON.stringify(fail?.args)).not.toContain("http");
  });

  it("treats a missing object as cleaned up", async () => {
    const db = stubDb({ failing: { "room/gone.jpg": "404" } });
    const result = await removeStorageObjects(db, ["room/gone.jpg"]);
    expect(result.removed).toEqual(["room/gone.jpg"]);
    expect(result.failed).toEqual([]);
  });

  it("does not let one failing path block the others", async () => {
    const db = stubDb({ failing: { "room/bad.jpg": "500" } });
    const result = await removeStorageObjects(db, ["room/ok.jpg", "room/bad.jpg", "room/two.jpg"]);
    expect(result.removed).toEqual(["room/ok.jpg", "room/two.jpg"]);
    expect(result.failed).toEqual(["room/bad.jpg"]);
  });

  it("removes the thumbnail variant with the original", async () => {
    expect(storageVariants("room/a.jpg")).toEqual(["room/a.jpg", "room/a_thumb.jpg"]);
    const db = stubDb();
    await removeStorageObjects(db, ["room/a.jpg"]);
    expect(db.removed[0]).toEqual(["room/a.jpg", "room/a_thumb.jpg"]);
  });

  it("is idempotent when the same path is retried", async () => {
    const db = stubDb({ due: ["room/a.jpg", "room/a.jpg"] });
    const first = await processDeletionQueue(db, 100);
    const second = await processDeletionQueue(db, 100);
    expect(first.removed).toBe(1);
    expect(second.removed).toBe(1);
  });

  it("processes due entries in bounded batches", async () => {
    const db = stubDb({ due: ["room/a.jpg", "room/b.jpg"] });
    const result = await processDeletionQueue(db, 100);
    expect(result).toEqual({ processed: 2, removed: 2, failed: 0 });
    expect(db.rpcCalls[0]).toMatchObject({
      name: "due_storage_deletions",
      args: { p_limit: 100 },
    });
  });

  it("logs no path, URL or token on failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = stubDb({ failing: { "room/secret.jpg": "500" } });
    await removeStorageObjects(db, ["room/secret.jpg"]);
    const logged = warn.mock.calls.map((call) => String(call[0])).join(" ");
    expect(logged).not.toContain("room/secret.jpg");
    expect(logged).toContain("storage_remove_failed");
  });
});

describe("cleanup authorization", () => {
  const withToken = (token: string) =>
    new Request("https://crawler.today/api/public/admin/cleanup", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });

  it("rejects a missing token", async () => {
    const db = stubDb();
    const bare = new Request("https://crawler.today/api/public/admin/cleanup", { method: "POST" });
    expect(await authorizeCleanup(db, bare)).toBe(false);
  });

  it("rejects an invalid token", async () => {
    const hash = await sha256Hex(new TextEncoder().encode("real-token"));
    const db = stubDb({ tokenHash: hash });
    expect(await authorizeCleanup(db, withToken("wrong-token"))).toBe(false);
  });

  it("accepts the vault-generated database token", async () => {
    const hash = await sha256Hex(new TextEncoder().encode("real-token"));
    const db = stubDb({ tokenHash: hash });
    expect(await authorizeCleanup(db, withToken("real-token"))).toBe(true);
  });

  it("accepts the ADMIN_TOKEN fallback", async () => {
    process.env["ADMIN_TOKEN"] = "manual-token";
    const db = stubDb();
    expect(await authorizeCleanup(db, withToken("manual-token"))).toBe(true);
    expect(
      await authorizeCleanup(
        db,
        new Request("https://crawler.today/api/public/admin/cleanup", {
          method: "POST",
          headers: { "x-admin-token": "manual-token" },
        }),
      ),
    ).toBe(true);
  });

  it("fails closed without a registered hash", async () => {
    const db = stubDb();
    expect(await authorizeCleanup(db, withToken("anything"))).toBe(false);
    expect(await authorizeCleanup(null, withToken("anything"))).toBe(false);
  });

  it("never echoes token material in the route source", () => {
    const route = readFileSync("src/routes/api.public.admin.cleanup.ts", "utf8");
    expect(route).toContain("authorizeCleanup");
    expect(route).not.toMatch(/token["']?\s*:\s*["'][A-Za-z0-9]{16,}/);
    expect(CLEANUP_TOKEN_NAME).toBe("crawler_room_cleanup_token");
  });
});
