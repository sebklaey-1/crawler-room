/**
 * Submission package gate: docs/openai-submission-ready.json must stay complete
 * and in sync with the code for the 2026 Plugin Directory review checklist.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SURFACE_TOOLS } from "./mcp.surface";
import { UGC_POLICY } from "./safety";

const doc = JSON.parse(readFileSync("docs/openai-submission-ready.json", "utf8")) as Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
>;

describe("OpenAI submission package", () => {
  it("pins the canonical endpoints and support contact", () => {
    expect(doc["product"]).toBe("Crawler Room");
    expect(doc["mcp_endpoint"]).toBe("https://crawler.today/mcp");
    expect(doc["protected_resource_metadata"]).toBe(
      "https://crawler.today/.well-known/oauth-protected-resource/mcp",
    );
    expect(doc["support_email"]).toBe("info@crawler.today");
  });

  it("documents exactly the seven published tools", () => {
    const names = doc["tools"].map((tool: { name: string }) => tool.name).sort();
    expect(names).toEqual(SURFACE_TOOLS.map((tool) => tool.name).sort());
  });

  it("ships starter prompts and at least five positive and three negative test cases", () => {
    expect(doc["starter_prompts"].length).toBeGreaterThanOrEqual(5);
    expect(doc["test_cases"]["positive"].length).toBeGreaterThanOrEqual(5);
    expect(doc["test_cases"]["negative"].length).toBeGreaterThanOrEqual(3);
  });

  it("declares a general audience without an adult experience", () => {
    expect(doc["audience"]["rating"]).toMatch(/13\+/);
    expect(doc["audience"]["mature_or_adult_experience"]).toBe(false);
    expect(doc["audience"]["not_directed_to_children_under_13"]).toBe(true);
  });

  it("keeps the published UGC policy in sync with safety.ts", () => {
    const blocked = UGC_POLICY.filter((rule) => rule.enforcement === "block").map(
      (rule) => rule.category,
    );
    expect(doc["ugc_policy"]["blocked_categories"].sort()).toEqual([...blocked].sort());
  });

  it("states input and response minimization and the secrets it never collects", () => {
    const never = doc["data_minimization"]["never_collected"].join(" ").toLowerCase();
    for (const item of ["password", "api key", "mfa", "government id", "health", "payment card"]) {
      expect(never, item).toContain(item.split(" ")[0]!);
    }
    expect(doc["data_minimization"]["inputs"]).toMatch(/no conversation history/i);
    expect(doc["data_minimization"]["responses"]).toMatch(/internal ids|internal identifiers/i);
  });

  it("carries release notes, availability and the policy attestations", () => {
    expect(doc["release_notes"]["version"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(doc["release_notes"]["highlights"].length).toBeGreaterThanOrEqual(3);
    expect(doc["availability"]["regions"]).toBeTruthy();
    expect(doc["attestations"]["no_openai_affiliation"]).toMatch(/not made, endorsed/i);
    expect(doc["attestations"]["no_secret_collection"]).toBe(true);
    expect(doc["attestations"]["reviewer_can_authenticate_without_mfa"]).toBe(true);
  });
});
