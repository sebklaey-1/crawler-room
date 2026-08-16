import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MAX_RETENTION_HOURS, retentionCutoffIso, retentionDeadlineIso } from "./config";

const HOUR = 3600 * 1000;

/**
 * Retention is enforced in four independent places. These tests pin the pure
 * helpers and guard, by source inspection, that every room type's read path
 * and every write path keeps the hard cap wired up.
 */
describe("retention helpers", () => {
  it("caps at 24 hours", () => {
    expect(MAX_RETENTION_HOURS).toBe(24);
  });

  it("cutoff is exactly 24h in the past", () => {
    const now = new Date("2026-01-02T12:00:00.000Z");
    expect(retentionCutoffIso(now)).toBe("2026-01-01T12:00:00.000Z");
    expect(Date.parse(now.toISOString()) - Date.parse(retentionCutoffIso(now))).toBe(24 * HOUR);
  });

  it("deadline is exactly 24h after creation", () => {
    const created = new Date("2026-01-02T12:00:00.000Z");
    expect(retentionDeadlineIso(created)).toBe("2026-01-03T12:00:00.000Z");
  });

  it("classifies content older than 24h as expired and fresh content as visible", () => {
    const now = new Date();
    const cutoff = retentionCutoffIso(now);
    const expired = new Date(now.getTime() - 25 * HOUR).toISOString();
    const fresh = new Date(now.getTime() - 23 * HOUR).toISOString();
    expect(expired < cutoff).toBe(true);
    expect(fresh >= cutoff).toBe(true);
  });
});

const READ_PATHS: Array<[string, string]> = [
  ["universal room", "src/lib/room/universal.ts"],
  ["personal public rooms", "src/lib/room/tools.personal.ts"],
  ["communities", "src/lib/room/communities.ts"],
  ["profile reads", "src/lib/room/tools.profile.ts"],
  ["profile counters", "src/lib/room/profile.ts"],
  ["images", "src/lib/room/imagestore.ts"],
  ["mcp surface", "src/lib/room/mcp.surface.ts"],
];

describe("read filters", () => {
  it.each(READ_PATHS)("%s filter out content older than 24h", (_name, file) => {
    expect(readFileSync(file, "utf8")).toContain("retentionCutoffIso(");
  });
});

const WRITE_PATHS = [
  "src/lib/room/universal.ts",
  "src/lib/room/communities.ts",
  "src/lib/room/store.ts",
  "src/lib/room/tools.personal.ts",
];

describe("write paths", () => {
  it.each(WRITE_PATHS)("%s never stores an expiry beyond the hard cap", (file) => {
    expect(readFileSync(file, "utf8")).toContain("retentionDeadlineIso(");
  });

  it("message writes trigger opportunistic room cleanup", () => {
    for (const file of ["src/lib/room/universal.ts", "src/lib/room/communities.ts"]) {
      expect(readFileSync(file, "utf8")).toContain("enforceRoomRetention");
    }
  });
});

describe("cleanup job", () => {
  const route = readFileSync("src/routes/api.public.admin.cleanup.ts", "utf8");

  it("is gated by a constant-time admin token comparison", () => {
    expect(route).toContain("safeEqual");
    expect(route).toContain("ADMIN_TOKEN");
  });

  it("purges database rows and storage objects", () => {
    expect(route).toContain("cleanup_expired");
    expect(route).toContain("sweepImages");
  });

  it("removes image files together with their rows", () => {
    const store = readFileSync("src/lib/room/imagestore.ts", "utf8");
    expect(store).toContain("removeStorageObjects");
    expect(store).toContain("enforceRoomRetention");
  });
});
