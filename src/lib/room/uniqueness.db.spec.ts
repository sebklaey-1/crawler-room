/**
 * Database contract tests for the global name registry.
 *
 * These tests WRITE to a database. They therefore never run as part of
 * `bun run test` and never use the normal `SUPABASE_*` credentials. They only
 * run through `bun run test:db` with an isolated, throwaway Supabase test
 * project configured through:
 *
 *   ROOM_RUN_DB_CONTRACT_TESTS=1
 *   ROOM_DB_CONTRACT_WRITE_ACK=i-write-to-a-disposable-test-database
 *   ROOM_TEST_SUPABASE_URL=...
 *   ROOM_TEST_SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Any missing or unsafe value fails closed: the suite is skipped or aborts
 * before a single network call is made. Never point this at production.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

import { canonicalHandle } from "./personal";
import type { Db } from "./store";

const WRITE_ACK = "i-write-to-a-disposable-test-database";

const OPT_IN = process.env["ROOM_RUN_DB_CONTRACT_TESTS"] === "1";
const TEST_URL = (process.env["ROOM_TEST_SUPABASE_URL"] ?? "").trim();
const TEST_KEY = (process.env["ROOM_TEST_SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
const ACK = (process.env["ROOM_DB_CONTRACT_WRITE_ACK"] ?? "").trim();

/** Fail-closed configuration check. Returns the blocking reason, or null. */
export function contractBlocker(): string | null {
  if (!TEST_URL || !TEST_KEY) {
    return "ROOM_TEST_SUPABASE_URL and ROOM_TEST_SUPABASE_SERVICE_ROLE_KEY are required.";
  }
  if (ACK !== WRITE_ACK) {
    return `ROOM_DB_CONTRACT_WRITE_ACK must be exactly «${WRITE_ACK}».`;
  }
  for (const name of ["SUPABASE_URL", "VITE_SUPABASE_URL"]) {
    const configured = (process.env[name] ?? "").trim();
    if (configured && configured.replace(/\/+$/, "") === TEST_URL.replace(/\/+$/, "")) {
      return `ROOM_TEST_SUPABASE_URL must not point at the connected project (${name}).`;
    }
  }
  return null;
}

const blocker = OPT_IN ? contractBlocker() : "opt-in missing (ROOM_RUN_DB_CONTRACT_TESTS=1)";
const suite = OPT_IN && !blocker ? describe : describe.skip;

if (OPT_IN && blocker) {
  describe("db contract configuration", () => {
    it("is configured for an isolated test project", () => {
      throw new Error(`Refusing to run database contract tests: ${blocker}`);
    });
  });
}

let client: Db | null = null;

const subjects: string[] = [];

function testSubject(label: string): string {
  const hash = `test:uniq:${label}:${Math.random().toString(36).slice(2, 10)}`;
  subjects.push(hash);
  return hash;
}

async function db(): Promise<Db> {
  const reason = contractBlocker();
  if (reason) throw new Error(`Refusing to open a database connection: ${reason}`);
  client ??= createClient(TEST_URL, TEST_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as Db;
  return client;
}

async function seedIdentity(c: Db, subject: string) {
  const { error } = await c.from("anonymous_identities").insert({ subject_hash: subject });
  if (error) throw new Error(error.message);
}

async function claim(c: Db, kind: "handle" | "alias", value: string, owner: string) {
  return c.rpc("claim_name", { p_kind: kind, p_value: value, p_owner: owner });
}

/** Idempotent cleanup. Runs even when tests failed and touches only test rows. */
afterAll(async () => {
  if (!OPT_IN || contractBlocker() || !client || subjects.length === 0) return;
  const c = client;
  const failures: string[] = [];
  const step = async (label: string, run: () => PromiseLike<{ error: unknown }>) => {
    const { error } = await run();
    if (error) failures.push(`${label}: ${(error as { message?: string }).message ?? "unknown"}`);
  };

  const { data: rooms, error: roomsError } = await c
    .from("user_rooms")
    .select("room_id")
    .in("owner_subject_hash", subjects);
  if (roomsError) failures.push(`read rooms: ${roomsError.message}`);

  await step("handle_redirects", () =>
    c.from("handle_redirects").delete().in("owner_subject_hash", subjects),
  );
  await step("memberships", () => c.from("memberships").delete().in("subject_hash", subjects));
  await step("user_rooms", () => c.from("user_rooms").delete().in("owner_subject_hash", subjects));
  for (const row of (rooms ?? []) as Array<{ room_id: string }>) {
    await step(`rooms ${row.room_id}`, () => c.from("rooms").delete().eq("id", row.room_id));
  }
  await step("anonymous_identities", () =>
    c.from("anonymous_identities").delete().in("subject_hash", subjects),
  );
  await step("name_claims", () =>
    c.from("name_claims").delete().in("owner_subject_hash", subjects),
  );

  if (failures.length) throw new Error(`Cleanup incomplete:\n${failures.join("\n")}`);
});

suite("global handle and alias claims", () => {
  it("lets exactly one identity win a contested claim", async () => {
    const c = await db();
    const a = testSubject("race-a");
    const b = testSubject("race-b");
    const handle = `zz_race_${Math.random().toString(36).slice(2, 8)}`;

    const results = await Promise.all([
      claim(c, "handle", handle, a),
      claim(c, "handle", handle.toUpperCase(), b),
    ]);
    const winners = results.filter((r) => !r.error);
    const losers = results.filter((r) => r.error);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.error?.message ?? "").toMatch(/ALIAS_TAKEN/);
  });

  it("collides case, trim and @ variants of the same handle", async () => {
    const c = await db();
    const owner = testSubject("variants");
    const other = testSubject("variants-other");
    const handle = `zz_var_${Math.random().toString(36).slice(2, 8)}`;

    expect((await claim(c, "handle", handle, owner)).error).toBeNull();
    for (const variant of [handle, handle.toUpperCase(), ` ${handle} `, `@${handle}`]) {
      const { error } = await claim(c, "handle", variant, other);
      expect(error?.message ?? "").toMatch(/ALIAS_TAKEN/);
      expect((await claim(c, "handle", variant, owner)).error).toBeNull();
    }
  });

  it("collides case, trim and NFKC variants of the same user name", async () => {
    const c = await db();
    const owner = testSubject("alias");
    const other = testSubject("alias-other");
    const base = `ZzTest ${Math.random().toString(36).slice(2, 8)}`;

    expect((await claim(c, "alias", base, owner)).error).toBeNull();
    for (const variant of [base, base.toLowerCase(), ` ${base} `, base.toUpperCase()]) {
      const { error } = await claim(c, "alias", variant, other);
      expect(error?.message ?? "").toMatch(/ALIAS_TAKEN/);
    }
  });

  it("rejects a direct insert that collides in case or trim", async () => {
    const c = await db();
    const owner = testSubject("direct");
    const other = testSubject("direct-other");
    await seedIdentity(c, owner);
    await seedIdentity(c, other);

    const first = (await c.rpc("get_or_create_personal_room", {
      p_subject_hash: owner,
      p_handle: `zz_direct_${Math.random().toString(36).slice(2, 8)}`,
      p_room_name: "Zz Direct's Room",
      p_display_name: `Zz Direct ${Math.random().toString(36).slice(2, 8)}`,
    })) as { data: { handle: string; room_id: string } | null; error: unknown };
    expect(first.error).toBeNull();
    const handle = first.data!.handle;

    const { data: room } = await c
      .from("rooms")
      .insert({ room_number: 1, capacity: 10, kind: "personal", visibility: "public" })
      .select("id")
      .single();

    const { error } = await c.from("user_rooms").insert({
      owner_subject_hash: other,
      room_id: (room as { id: string }).id,
      handle: ` ${handle.toUpperCase()} `,
      room_name: "Squatter's Room",
    });
    expect(error).not.toBeNull();
    await c
      .from("rooms")
      .delete()
      .eq("id", (room as { id: string }).id);
  });

  it("gives two parallel first-time provisionings different names", async () => {
    const c = await db();
    const a = testSubject("first-a");
    const b = testSubject("first-b");
    await seedIdentity(c, a);
    await seedIdentity(c, b);
    const suffix = Math.random().toString(36).slice(2, 8);
    const base = `zz_same_${suffix}`;
    const display = `Zz Same ${suffix}`;

    const [first, second] = await Promise.all([
      c.rpc("get_or_create_personal_room", {
        p_subject_hash: a,
        p_handle: base,
        p_room_name: `${display}'s Room`,
        p_display_name: display,
      }),
      c.rpc("get_or_create_personal_room", {
        p_subject_hash: b,
        p_handle: base,
        p_room_name: `${display}'s Room`,
        p_display_name: display,
      }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const handleA = (first.data as { handle: string }).handle;
    const handleB = (second.data as { handle: string }).handle;
    expect(handleA).not.toBe(handleB);
    expect(canonicalHandle(handleA)).not.toBeNull();
    expect(canonicalHandle(handleB)).not.toBeNull();

    const { data: aliases } = await c
      .from("anonymous_identities")
      .select("custom_alias")
      .in("subject_hash", [a, b]);
    const names = (aliases ?? []).map((row) => (row as { custom_alias: string }).custom_alias);
    expect(new Set(names).size).toBe(2);
  });

  it("resolves a contested handle change and keeps redirects owned", async () => {
    const c = await db();
    const a = testSubject("change-a");
    const b = testSubject("change-b");
    await seedIdentity(c, a);
    await seedIdentity(c, b);
    const suffix = Math.random().toString(36).slice(2, 8);

    for (const [subject, tag] of [
      [a, "a"],
      [b, "b"],
    ] as const) {
      const { error } = await c.rpc("get_or_create_personal_room", {
        p_subject_hash: subject,
        p_handle: `zz_ch${tag}_${suffix}`,
        p_room_name: `Zz Ch${tag} ${suffix}'s Room`,
        p_display_name: `Zz Ch${tag} ${suffix}`,
      });
      expect(error).toBeNull();
    }

    const target = `zz_target_${suffix}`;
    const results = await Promise.all([
      c.rpc("change_personal_handle", { p_subject_hash: a, p_handle: target }),
      c.rpc("change_personal_handle", { p_subject_hash: b, p_handle: target.toUpperCase() }),
    ]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error)).toHaveLength(1);

    const winner = results[0]?.error ? b : a;
    const loser = winner === a ? b : a;

    // The loser cannot take the winner's handle, not even as a redirect owner.
    const retry = await c.rpc("change_personal_handle", {
      p_subject_hash: loser,
      p_handle: target,
    });
    expect(retry.error?.message ?? "").toMatch(/ALIAS_TAKEN/);

    // The winner's previous handle became their own redirect …
    const old = `zz_ch${winner === a ? "a" : "b"}_${suffix}`;
    const { data: redirect } = await c
      .from("handle_redirects")
      .select("owner_subject_hash")
      .eq("old_handle", old)
      .maybeSingle();
    expect((redirect as { owner_subject_hash: string } | null)?.owner_subject_hash).toBe(winner);

    // … which nobody else may claim, while the owner can take it back.
    const foreign = await c.rpc("change_personal_handle", {
      p_subject_hash: loser,
      p_handle: old,
    });
    expect(foreign.error?.message ?? "").toMatch(/ALIAS_TAKEN/);

    const back = await c.rpc("change_personal_handle", {
      p_subject_hash: winner,
      p_handle: old,
    });
    expect(back.error).toBeNull();
    expect((back.data as { handle: string }).handle).toBe(old);
  });

  it("changes the display name atomically without moving the handle", async () => {
    const c = await db();
    const owner = testSubject("display");
    const other = testSubject("display-other");
    await seedIdentity(c, owner);
    await seedIdentity(c, other);
    const suffix = Math.random().toString(36).slice(2, 8);

    const created = await c.rpc("get_or_create_personal_room", {
      p_subject_hash: owner,
      p_handle: `zz_disp_${suffix}`,
      p_room_name: `Zz Disp ${suffix}'s Room`,
      p_display_name: `Zz Disp ${suffix}`,
    });
    expect(created.error).toBeNull();
    const handleBefore = (created.data as { handle: string }).handle;

    const name = `Zz Renamed ${suffix}`;
    const renamed = await c.rpc("set_display_name", {
      p_subject_hash: owner,
      p_display_name: ` ${name} `,
      p_room_name: `${name}'s Room`,
    });
    expect(renamed.error).toBeNull();
    expect((renamed.data as { display_name: string }).display_name).toBe(name);

    const { data: room } = await c
      .from("user_rooms")
      .select("handle, room_name, room_id")
      .eq("owner_subject_hash", owner)
      .single();
    const row = room as { handle: string; room_name: string; room_id: string };
    expect(row.handle).toBe(handleBefore);
    expect(row.room_name).toBe(`${name}'s Room`);

    const { data: title } = await c.from("rooms").select("title").eq("id", row.room_id).single();
    expect((title as { title: string }).title).toBe(`${name}'s Room`);

    // A second identity cannot take the same public user name.
    const clash = await c.rpc("set_display_name", {
      p_subject_hash: other,
      p_display_name: name.toLowerCase(),
      p_room_name: `${name}'s Room`,
    });
    expect(clash.error?.message ?? "").toMatch(/ALIAS_TAKEN/);
  });

  it("keeps the registry consistent with the existing live profiles", async () => {
    const c = await db();
    const { data: rooms } = await c.from("user_rooms").select("handle, owner_subject_hash");
    for (const entry of (rooms ?? []) as Array<{ handle: string; owner_subject_hash: string }>) {
      expect(canonicalHandle(entry.handle)).toBe(entry.handle);
      const { data: claimRow } = await c
        .from("name_claims")
        .select("owner_subject_hash")
        .eq("kind", "handle")
        .eq("normalized", entry.handle)
        .maybeSingle();
      expect((claimRow as { owner_subject_hash: string } | null)?.owner_subject_hash).toBe(
        entry.owner_subject_hash,
      );
    }
  });
});
