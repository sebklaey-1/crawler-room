/**
 * Universal Room identity: profile handles are resolved server-side from the
 * pseudonymous subject hash, never from tool input, and only in the Universal
 * Room (anonymous topic rooms and communities stay untouched).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fakeDb } from "../../test/fake-db";
import { universalHandles, universalSelfLabel, universalSender } from "./universal";

const SELF = "hash-self";
const OTHER = "hash-other";

function dbWithHandles() {
  return fakeDb({
    user_rooms: {
      data: [
        { owner_subject_hash: SELF, handle: "satoshi" },
        { owner_subject_hash: OTHER, handle: "violet_falcon" },
      ],
    },
  });
}

describe("universal room identity", () => {
  it("maps subject hashes to profile handles", async () => {
    const map = await universalHandles(dbWithHandles(), [SELF, OTHER, null, undefined]);
    expect(map.get(SELF)).toBe("@satoshi");
    expect(map.get(OTHER)).toBe("@violet_falcon");
    expect(map.size).toBe(2);
  });

  it("does not query the database without subjects", async () => {
    const db = fakeDb({});
    const map = await universalHandles(db, [null, undefined]);
    expect(map.size).toBe(0);
    expect(db.calls).toHaveLength(0);
  });

  it("prefers the handle for own and foreign messages", () => {
    expect(universalSender("@satoshi", "Amber Marten")).toBe("@satoshi");
    expect(universalSender("@violet_falcon", "Blue Lynx")).toBe("@violet_falcon");
  });

  it("falls back to the generated alias when no profile handle exists", async () => {
    expect(universalSender(null, "Amber Marten")).toBe("Amber Marten");
    expect(universalSender("   ", "  Amber Marten ")).toBe("Amber Marten");
    expect(universalSender(null, null)).toBe("Unbekannt");

    const label = await universalSelfLabel(fakeDb({ user_rooms: { data: [] } }), SELF, "Blue Owl");
    expect(label).toBe("Blue Owl");
  });

  it("resolves the own label from the subject hash, not from input", async () => {
    expect(await universalSelfLabel(dbWithHandles(), SELF, "Amber Marten")).toBe("@satoshi");
  });

  it("never reads a handle from universal tool input (spoofing protection)", () => {
    const surface = readFileSync("src/lib/room/mcp.surface.ts", "utf8");
    const universalBlock = surface.slice(
      surface.indexOf("const universalInput"),
      surface.indexOf("/* ============================= 2. public_room"),
    );
    expect(universalBlock).not.toMatch(/data\.(handle|alias|display_name)/);
    expect(universalBlock).toMatch(/universalSelfLabel\(db, identity\.subjectHash/);
    expect(universalBlock).toMatch(/memberships\(alias, subject_hash\)/);
  });

  it("leaves anonymous topic rooms and communities unchanged", () => {
    for (const file of ["src/lib/room/communities.ts", "src/lib/room/personal.ts"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/universalHandles|universalSender/);
    }
  });
});
