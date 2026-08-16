import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The consent screen must stay accountless: exactly one anonymous sign-in
 * call, no credential inputs, no sign-up, and a fail-closed error state.
 */
const CONSENT = readFileSync("src/components/oauth-consent.tsx", "utf8");

describe("accountless OAuth consent", () => {
  it("uses anonymous sign-in", () => {
    expect(CONSENT).toContain("signInAnonymously()");
    expect(CONSENT.match(/signInAnonymously\(\)/g) ?? []).toHaveLength(1);
  });

  it("has no email, password or sign-up flow", () => {
    for (const forbidden of [
      "signInWithPassword",
      "signUp(",
      'type="password"',
      'type="email"',
      "emailRedirectTo",
    ]) {
      expect(CONSENT).not.toContain(forbidden);
    }
  });

  it("guards against creating more than one anonymous session", () => {
    expect(CONSENT).toContain("anonymousStarted");
  });

  it("fails closed when anonymous sign-in is unavailable", () => {
    expect(CONSENT).toContain("ANONYMOUS_UNAVAILABLE");
    expect(CONSENT).toContain("setConnected(false)");
  });

  it("states the 24 hour retention on screen", () => {
    expect(CONSENT).toContain("24 Stunden");
  });
});
