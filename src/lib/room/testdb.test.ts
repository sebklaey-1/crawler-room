/**
 * Guard: a normal test run must never be able to reach a real database, even
 * when production-shaped Supabase credentials are present in the process.
 */
import { afterEach, describe, expect, it } from "vitest";

import { __setTestDb, getDb } from "./store";
import { fakeDb } from "@/test/fake-db";

describe("test-only database injection", () => {
  afterEach(() => {
    __setTestDb(null);
    delete process.env["SUPABASE_URL"];
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
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
});
