import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { LEGAL_LINKS } from "./legal";
import { openAiAppsChallengeResponse } from "./challenge";
import { SURFACE_TOOLS } from "./mcp.surface";

const ROUTE_FILE: Record<string, string> = {
  "/privacy": "src/routes/privacy.tsx",
  "/terms": "src/routes/terms.tsx",
  "/support": "src/routes/support.tsx",
  "/safety": "src/routes/safety.tsx",
  "/data-deletion": "src/routes/data-deletion.tsx",
};

describe("public mandatory pages", () => {
  it("links exactly the five required pages", () => {
    expect(LEGAL_LINKS.map((link) => link.href)).toEqual([
      "/privacy",
      "/terms",
      "/support",
      "/safety",
      "/data-deletion",
    ]);
  });

  it("ships a route file with head metadata for every link", () => {
    for (const link of LEGAL_LINKS) {
      const file = ROUTE_FILE[link.href]!;
      expect(existsSync(file), `${file} missing`).toBe(true);
      const source = readFileSync(file, "utf8");
      expect(source).toContain("head: () => ({");
      expect(source).toContain("og:title");
    }
  });

  it("states the publisher and the no-affiliation notice", () => {
    const terms = readFileSync("src/routes/terms.tsx", "utf8");
    expect(terms).toContain("SEBKLAEY Agency");
    expect(terms).toMatch(/not affiliated with/i);
  });

  it("documents enforced retention in the privacy policy", () => {
    const privacy = readFileSync("src/routes/privacy.tsx", "utf8");
    expect(privacy).toMatch(/newest 7 messages/);
    expect(privacy).toMatch(/newest 3 approved images/);
    expect(privacy).toMatch(/HMAC-SHA256/);
  });
});

describe("openai domain verification", () => {
  it("404s while no challenge token is configured", async () => {
    const previous = process.env["OPENAI_APPS_CHALLENGE"];
    delete process.env["OPENAI_APPS_CHALLENGE"];
    const response = openAiAppsChallengeResponse();
    expect(response.status).toBe(404);
    if (previous !== undefined) process.env["OPENAI_APPS_CHALLENGE"] = previous;
  });

  it("returns the raw token as text/plain when configured", async () => {
    const previous = process.env["OPENAI_APPS_CHALLENGE"];
    process.env["OPENAI_APPS_CHALLENGE"] = "challenge-token-123";
    const response = openAiAppsChallengeResponse();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("challenge-token-123");
    if (previous === undefined) delete process.env["OPENAI_APPS_CHALLENGE"];
    else process.env["OPENAI_APPS_CHALLENGE"] = previous;
  });
});

describe("response denylist audit", () => {
  const DENIED = [
    "subject_hash",
    "owner_subject_hash",
    "auth_user_hash",
    "storage_path",
    "membership_id",
    "account_id",
    "stripe",
    "requester_hash",
    "access_token",
  ];

  it("never declares an internal identifier in a tool output schema", () => {
    const serialized = JSON.stringify(SURFACE_TOOLS.map((tool) => tool.outputSchema));
    for (const term of DENIED) {
      expect(serialized, `output schema exposes ${term}`).not.toContain(term);
    }
  });

  it("keeps exactly the seven public tool names", () => {
    expect(SURFACE_TOOLS.map((tool) => tool.name).sort()).toHaveLength(7);
  });
});
