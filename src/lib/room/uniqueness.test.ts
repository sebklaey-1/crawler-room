/**
 * Pure name-normalisation unit tests. No database, no network, no service
 * credentials — this file is safe in every CI environment.
 *
 * The real database contract tests live in `uniqueness.db.spec.ts` and only
 * run through the explicit opt-in script `bun run test:db`.
 */
import { describe, expect, it } from "vitest";

import { canonicalHandle, slugifyHandle } from "./personal";
import { validateHandle } from "./profile";
import { aliasKey } from "./alias";

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
    // genuine NFKC compatibility form (fullwidth letters, U+FF33 …)
    expect(aliasKey("\uFF33\uFF45\uFF42\uFF41\uFF53\uFF54\uFF49\uFF41\uFF4E")).toBe(key);
    // circled digit one folds to ASCII "1"
    expect(aliasKey("Room\u2460")).toBe(aliasKey("Room1"));
    expect(aliasKey("Sebas  tian")).toBe(aliasKey("Sebas tian"));
  });
});
