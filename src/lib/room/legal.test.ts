import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { LEGAL_LINKS, SUPPORT_EMAIL, publicSupportEmail, supportEmailEnvMatches } from "./legal";
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

describe("public support contact", () => {
  it("resolves the canonical address without any build variable", () => {
    expect(SUPPORT_EMAIL).toBe("info@crawler.today");
    expect(publicSupportEmail()).toBe("info@crawler.today");
  });

  it("accepts only the exact same address as an env override", () => {
    expect(supportEmailEnvMatches(undefined)).toBe(true);
    expect(supportEmailEnvMatches("  info@crawler.today ")).toBe(true);
    expect(supportEmailEnvMatches("support@example.com")).toBe(false);
  });

  it("renders one exact mailto link and no foreign support address", () => {
    const component = readFileSync("src/components/support-contact.tsx", "utf8");
    expect(component).toContain("mailto:${email}");
    const pages = [
      "src/routes/support.tsx",
      "src/routes/privacy.tsx",
      "src/routes/data-deletion.tsx",
    ];
    for (const page of pages) {
      const text = readFileSync(page, "utf8");
      const mailtos = text.match(/mailto:[^"'`\s)]+/g) ?? [];
      for (const link of mailtos) expect(link).toBe("mailto:info@crawler.today");
      const addresses = text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? [];
      for (const address of addresses) expect(address.toLowerCase()).toBe("info@crawler.today");
    }
  });

  it("keeps the support form and promises no immediate reply", () => {
    const support = readFileSync("src/routes/support.tsx", "utf8");
    expect(support).toContain("<form");
    expect(/immediate (reply|response)|sofortige Antwort|instant reply/i.test(support)).toBe(false);
  });
});

describe("legal copy gates", () => {
  const privacy = readFileSync("src/routes/privacy.tsx", "utf8");
  const terms = readFileSync("src/routes/terms.tsx", "utf8");
  const safety = readFileSync("src/routes/safety.tsx", "utf8");

  it("uses the precise, controller-limited OpenAI training statement", () => {
    expect(privacy).not.toMatch(/We do not send data to OpenAI for\s+training/i);
    expect(privacy).toMatch(/does not separately/i);
    expect(privacy).toMatch(/own terms, privacy policy and applicable product settings/i);
  });

  it("agrees across privacy, terms and safety on the general-audience framing", () => {
    for (const [name, text] of [
      ["privacy", privacy],
      ["terms", terms],
      ["safety", safety],
    ] as const) {
      expect(text, `${name}: general audience`).toMatch(/general[- ]audience|general audience/i);
      expect(text, `${name}: under 13`).toMatch(/13/);
      expect(text, `${name}: no account`).not.toMatch(
        /create an account with your email and password/i,
      );
    }
  });

  it("invents no age verification or legal availability guarantee", () => {
    for (const text of [privacy, terms, safety]) {
      expect(text).not.toMatch(/age[- ]verified|age verification|id check/i);
      expect(text).not.toMatch(/available worldwide|legally cleared/i);
    }
  });
});
