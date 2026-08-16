/**
 * DB contract tests for the global name registry.
 *
 * Handles (`user_rooms.handle` plus every old handle in `handle_redirects`)
 * and chosen public user names (`anonymous_identities.custom_alias`) live in
 * one global, case-insensitive namespace enforced by `public.name_claims`.
 *
 * These tests talk to the real database with the service role and clean up
 * after themselves. They are skipped when no service credentials are present.
 */
import { afterAll, describe, expect, it } from "vitest";

import { canonicalHandle, slugifyHandle } from "./personal";
import { validateHandle } from "./profile";
import { aliasKey } from "./alias";
import type { Db } from "./store";

const HAS_DB = Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"]);
const suite = HAS_DB ? describe : describe.skip;

const subjects: string[] = [];

function testSubject(label: string): string {
  const hash = `test:uniq:${label}:${Math.random().toString(36).slice(2, 10)}`;
  subjects.push(hash);
  return hash;
}

async function db(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

async function seedIdentity(client: Db, subject: string) {
  const { error } = await client.from("anonymous_identities").insert({ subject_hash: subject });
  if (error) throw new Error(error.message);
}

async function claim(client: Db, kind: "handle" | "alias", value: string, owner: string) {
  return client.rpc("claim_name", { p_kind: kind, p_value: value, p_owner: owner });
}

afterAll(async () => {
  if (!HAS_DB || !subjects.length) return;
  const client = await db();
  const { data: rooms } = await client
    .from("user_rooms")
    .select("room_id")
    .in("owner_subject_hash", subjects);
  await client.from("handle_redirects").delete().in("owner_subject_hash", subjects);
  await client.from("memberships").delete().in("subject_hash", subjects);
  await client.from("user_rooms").delete().in("owner_subject_hash", subjects);
  for (const row of (rooms ?? []) as Array<{ room_id: string }>) {
    await client.from("rooms").delete().eq("id", row.room_id);
  }
  await client.from("anonymous_identities").delete().in("subject_hash", subjects);
  await client.from("name_claims").delete().in("owner_subject_hash", subjects);
});

describe("name normalisation (pure)", () => {
  it("treats case, trim and a leading @ as the same handle", () => {
    for (const variant of ["alice", "Alice", " alice ", "@ALICE"]) {
      expect(canonicalHandle(variant)).toBe("alice");
    }
  });

  it("rejects invalid explicit handles instead of slugifying them", () => {
    for (const bad of ["a b", "hä", "ab", "x".repeat(31), "a-b", ""]) {
      expect(canonicalHandle(bad)).toBeNull();
      expect(() => validateHandle(bad)).toThrow();
    }
    // derived base handles may be slugified — explicit ones may not
    expect(slugifyHandle("Amber Crane")).toBe("amber_crane");
  });

  it("treats case, trim and NFKC variants as the same public user name", () => {
    const key = aliasKey("Sebastian");
    expect(aliasKey("sebastian")).toBe(key);
    expect(aliasKey(" Sebastian ")).toBe(key);
    expect(aliasKey("Sebastian")).toBe(key); // fullwidth NFKC form
    expect(aliasKey("Sebas  tian")).toBe(aliasKey("Sebas tian"));
  });
});

suite("global handle and alias claims", () => {
  it("lets exactly one identity win a contested claim", async () => {
    const client = await db();
    const a = testSubject("race-a");
    const b = testSubject("race-b");
    const handle = `zz_race_${Math.random().toString(36).slice(2, 8)}`;

    const results = await Promise.all([
      claim(client, "handle", handle, a),
      claim(client, "handle", handle.toUpperCase(), b),
    ]);
    const winners = results.filter((r) => !r.error);
    const losers = results.filter((r) => r.error);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.error?.message ?? "").toMatch(/ALIAS_TAKEN/);
  });

  it("collides case, trim and @ variants of the same handle", async () => {
    const client = await db();
    const owner = testSubject("variants");
    const other = testSubject("variants-other");
    const handle = `zz_var_${Math.random().toString(36).slice(2, 8)}`;

    expect((await claim(client, "handle", handle, owner)).error).toBeNull();
    for (const variant of [handle, handle.toUpperCase(), ` ${handle} `, `@${handle}`]) {
      const { error } = await claim(client, "handle", variant, other);
      expect(error?.message ?? "").toMatch(/ALIAS_TAKEN/);
      expect((await claim(client, "handle", variant, owner)).error).toBeNull();
    }
  });

  it("collides case, trim and NFKC variants of the same user name", async () => {
    const client = await db();
    const owner = testSubject("alias");
    const other = testSubject("alias-other");
    const base = `ZzTest ${Math.random().toString(36).slice(2, 8)}`;

    expect((await claim(client, "alias", base, owner)).error).toBeNull();
    for (const variant of [base, base.toLowerCase(), ` ${base} `, base.toUpperCase()]) {
      const { error } = await claim(client, "alias", variant, other);
      expect(error?.message ?? "").toMatch(/ALIAS_TAKEN/);
    }
  });

  it("rejects a direct insert that collides in case or trim", async () => {
    const client = await db();
    const owner = testSubject("direct");
    const other = testSubject("direct-other");
    await seedIdentity(client, owner);
    await seedIdentity(client, other);

    const first = (await client.rpc("get_or_create_personal_room", {
      p_subject_hash: owner,
      p_handle: `zz_direct_${Math.random().toString(36).slice(2, 8)}`,
      p_room_name: "Zz Direct's Room",
      p_display_name: `Zz Direct ${Math.random().toString(36).slice(2, 8)}`,
    })) as { data: { handle: string; room_id: string } | null; error: unknown };
    expect(first.error).toBeNull();
    const handle = first.data!.handle;

    const { data: room } = await client
      .from("rooms")
      .insert({ room_number: 1, capacity: 10, kind: "personal", visibility: "public" })
      .select("id")
      .single();

    const { error } = await client.from("user_rooms").insert({
      owner_subject_hash: other,
      room_id: (room as { id: string }).id,
      handle: ` ${handle.toUpperCase()} `,
      room_name: "Squatter's Room",
    });
    expect(error).not.toBeNull();
    await client
      .from("rooms")
      .delete()
      .eq("id", (room as { id: string }).id);
  });

  it("gives two parallel first-time provisionings different names", async () => {
    const client = await db();
    const a = testSubject("first-a");
    const b = testSubject("first-b");
    await seedIdentity(client, a);
    await seedIdentity(client, b);
    const suffix = Math.random().toString(36).slice(2, 8);
    const base = `zz_same_${suffix}`;
    const display = `Zz Same ${suffix}`;

    const [first, second] = await Promise.all([
      client.rpc("get_or_create_personal_room", {
        p_subject_hash: a,
        p_handle: base,
        p_room_name: `${display}'s Room`,
        p_display_name: display,
      }),
      client.rpc("get_or_create_personal_room", {
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

    const { data: aliases } = await client
      .from("anonymous_identities")
      .select("custom_alias")
      .in("subject_hash", [a, b]);
    const names = (aliases ?? []).map((row) => (row as { custom_alias: string }).custom_alias);
    expect(new Set(names).size).toBe(2);
  });

  it("resolves a contested handle change and keeps redirects owned", async () => {
    const client = await db();
    const a = testSubject("change-a");
    const b = testSubject("change-b");
    await seedIdentity(client, a);
    await seedIdentity(client, b);
    const suffix = Math.random().toString(36).slice(2, 8);

    for (const [subject, tag] of [
      [a, "a"],
      [b, "b"],
    ] as const) {
      const { error } = await client.rpc("get_or_create_personal_room", {
        p_subject_hash: subject,
        p_handle: `zz_ch${tag}_${suffix}`,
        p_room_name: `Zz Ch${tag} ${suffix}'s Room`,
        p_display_name: `Zz Ch${tag} ${suffix}`,
      });
      expect(error).toBeNull();
    }

    const target = `zz_target_${suffix}`;
    const results = await Promise.all([
      client.rpc("change_personal_handle", { p_subject_hash: a, p_handle: target }),
      client.rpc("change_personal_handle", { p_subject_hash: b, p_handle: target.toUpperCase() }),
    ]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error)).toHaveLength(1);

    const winner = results[0]?.error ? b : a;
    const loser = winner === a ? b : a;

    // The loser cannot take the winner's handle, not even as a redirect owner.
    const retry = await client.rpc("change_personal_handle", {
      p_subject_hash: loser,
      p_handle: target,
    });
    expect(retry.error?.message ?? "").toMatch(/ALIAS_TAKEN/);

    // The winner's previous handle became their own redirect …
    const old = `zz_ch${winner === a ? "a" : "b"}_${suffix}`;
    const { data: redirect } = await client
      .from("handle_redirects")
      .select("owner_subject_hash")
      .eq("old_handle", old)
      .maybeSingle();
    expect((redirect as { owner_subject_hash: string } | null)?.owner_subject_hash).toBe(winner);

    // … which nobody else may claim, while the owner can take it back.
    const foreign = await client.rpc("change_personal_handle", {
      p_subject_hash: loser,
      p_handle: old,
    });
    expect(foreign.error?.message ?? "").toMatch(/ALIAS_TAKEN/);

    const back = await client.rpc("change_personal_handle", {
      p_subject_hash: winner,
      p_handle: old,
    });
    expect(back.error).toBeNull();
    expect((back.data as { handle: string }).handle).toBe(old);
  });

  it("changes the display name atomically without moving the handle", async () => {
    const client = await db();
    const owner = testSubject("display");
    const other = testSubject("display-other");
    await seedIdentity(client, owner);
    await seedIdentity(client, other);
    const suffix = Math.random().toString(36).slice(2, 8);

    const created = await client.rpc("get_or_create_personal_room", {
      p_subject_hash: owner,
      p_handle: `zz_disp_${suffix}`,
      p_room_name: `Zz Disp ${suffix}'s Room`,
      p_display_name: `Zz Disp ${suffix}`,
    });
    expect(created.error).toBeNull();
    const handleBefore = (created.data as { handle: string }).handle;

    const name = `Zz Renamed ${suffix}`;
    const renamed = await client.rpc("set_display_name", {
      p_subject_hash: owner,
      p_display_name: ` ${name} `,
      p_room_name: `${name}'s Room`,
    });
    expect(renamed.error).toBeNull();
    expect((renamed.data as { display_name: string }).display_name).toBe(name);

    const { data: room } = await client
      .from("user_rooms")
      .select("handle, room_name, room_id")
      .eq("owner_subject_hash", owner)
      .single();
    const row = room as { handle: string; room_name: string; room_id: string };
    expect(row.handle).toBe(handleBefore);
    expect(row.room_name).toBe(`${name}'s Room`);

    const { data: title } = await client
      .from("rooms")
      .select("title")
      .eq("id", row.room_id)
      .single();
    expect((title as { title: string }).title).toBe(`${name}'s Room`);

    // A second identity cannot take the same public user name.
    const clash = await client.rpc("set_display_name", {
      p_subject_hash: other,
      p_display_name: name.toLowerCase(),
      p_room_name: `${name}'s Room`,
    });
    expect(clash.error?.message ?? "").toMatch(/ALIAS_TAKEN/);
  });

  it("keeps the registry consistent with the existing live profiles", async () => {
    const client = await db();
    const { data: rooms } = await client.from("user_rooms").select("handle, owner_subject_hash");
    for (const entry of (rooms ?? []) as Array<{ handle: string; owner_subject_hash: string }>) {
      expect(canonicalHandle(entry.handle)).toBe(entry.handle);
      const { data: claimRow } = await client
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
