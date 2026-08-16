/**
 * Guard: a normal test run must never be able to reach a real database, even
 * when production-shaped Supabase credentials are present in the process.
 *
 * The inherited environment is captured before each test and restored exactly
 * afterwards (including the "was undefined" case), so this file never weakens
 * the credentials the rest of the standard run inherits from the runner.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __setTestDb, getDb } from "./store";
import { fakeDb } from "@/test/fake-db";

const GUARDED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

describe("test-only database injection", () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const name of GUARDED_ENV) saved[name] = process.env[name];
  });

  afterEach(() => {
    __setTestDb(null);
    for (const name of GUARDED_ENV) {
      const original = saved[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  });

  it("fails closed without an override, even with service credentials present", async () => {
    process.env["SUPABASE_URL"] = "https://example.supabase.co";
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "sb_secret_dummy_value_for_the_guard_test";
    __setTestDb(null);
    await expect(getDb()).rejects.toThrow(/disabled in tests/);
  });

  it("returns the injected fake when one is set", async () => {
    const fake = fakeDb({ topics: { data: [] } });
    __setTestDb(fake);
    expect(await getDb()).toBe(fake);
  });

  it("keeps the override scoped: clearing it restores the fail-closed state", async () => {
    __setTestDb(fakeDb());
    __setTestDb(null);
    await expect(getDb()).rejects.toThrow(/__setTestDb/);
  });

  it("restores the inherited environment exactly", () => {
    for (const name of GUARDED_ENV) {
      expect(process.env[name]).toBe(saved[name]);
    }
  });
});
