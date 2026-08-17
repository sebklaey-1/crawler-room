/**
 * Canonical UGC policy matrix of Crawler Room.
 *
 * Crawler Room is a public, general-audience social surface (13+, not directed
 * to children under 13, no mature/adult experience). Every piece of
 * user-generated text — room and community messages, display names, handles,
 * bios, locations, room names, community and organisation titles and
 * descriptions — passes through `assertSafeUgc` before it is stored.
 *
 * Two-tier design, deliberately narrow:
 *
 * 1. BLOCK (fail closed) — only unambiguous, high-confidence violations. The
 *    write is refused with the stable public error code `POLICY_VIOLATION`;
 *    nothing is stored, nothing about the detector is disclosed.
 * 2. REVIEW — everything else stays writable and reachable through the normal
 *    report/moderation path. A single report never deletes other people's
 *    content; a human decides.
 *
 * The matrix is intentionally not a general profanity or opinion filter:
 * ordinary social content, criticism, news talk, health talk and dark humour
 * must pass. Detection is lexical and local — no external service, no paid
 * API, no user content leaves the server for classification.
 */
import { roomError } from "./errors";

export type UgcCategory =
  | "sexual_content"
  | "minor_sexualization"
  | "graphic_violence"
  | "hate_harassment"
  | "self_harm"
  | "illegal_goods"
  | "scam_credentials"
  | "doxxing"
  | "spam_injection";

export interface UgcPolicyRule {
  category: UgcCategory;
  /** What the category covers, in reviewer-readable words. */
  covers: string;
  /** `block` = refused at write time; `review` = reportable, human-decided. */
  enforcement: "block" | "review";
  /** High-confidence block patterns. Empty for review-only categories. */
  patterns: RegExp[];
}

/**
 * The matrix. Order is stable and every category required by the review
 * checklist is present, including the ones that are deliberately handled
 * through moderation rather than through an automatic filter.
 */
export const UGC_POLICY: UgcPolicyRule[] = [
  {
    category: "minor_sexualization",
    covers: "Any sexualisation of minors, in text, names, titles or image captions.",
    enforcement: "block",
    patterns: [
      /\b(child|kid|kids|minor|minors|teen|teens|preteen|underage|schoolgirl|schoolboy|loli|shota)\b[^.\n]{0,40}\b(porn|nude|nudes|naked|sex|sexual|sexy|hookup|hook up|escort|fuck|blowjob)\b/i,
      /\b(porn|nude|nudes|naked|sex|sexual|sexy|escort)\b[^.\n]{0,40}\b(child|kid|kids|minor|minors|preteen|underage|schoolgirl|schoolboy|loli|shota)\b/i,
      /\bcp\s*(links?|trade|swap)\b/i,
    ],
  },
  {
    category: "sexual_content",
    covers:
      "Pornographic content and adult/sexual services solicitation. Crawler Room is not an adult or dating experience.",
    enforcement: "block",
    patterns: [
      /\b(porn|pornhub|xxx\s*videos?|onlyfans|nudes)\b[^.\n]{0,30}\b(link|links|dm|telegram|whatsapp|join|free|sell|selling|buy)\b/i,
      /\b(escort|sex\s*service|sexcam|camgirl|hookers?)\b[^.\n]{0,30}\b(available|book|booking|price|prices|rate|rates|dm|contact)\b/i,
      /\bsell(ing)?\s+(my\s+)?(nudes|sex\s*tapes?)\b/i,
    ],
  },
  {
    category: "graphic_violence",
    covers: "Gore for shock value and credible threats of violence against people.",
    enforcement: "block",
    patterns: [
      /\bi(\s+am|'m|\s+will|'ll)\s+(going\s+to\s+)?(kill|shoot|stab|behead|bomb)\s+(you|him|her|them|u)\b/i,
      /\b(kill|shoot|stab|behead|bomb)\s+(you|him|her|them)\s+(tonight|tomorrow|today|now)\b/i,
    ],
  },
  {
    category: "hate_harassment",
    covers:
      "Dehumanising hate against protected groups, targeted harassment and threats. Criticism and disagreement are not hate.",
    enforcement: "block",
    patterns: [
      /\b(gas|exterminate|eradicate|lynch)\s+(all\s+)?(the\s+)?(jews|muslims|blacks|gays|trans|immigrants|women)\b/i,
      /\ball\s+(jews|muslims|blacks|gays|trans|immigrants)\s+(must|should)\s+(die|be\s+killed|be\s+gassed)\b/i,
    ],
  },
  {
    category: "self_harm",
    covers:
      "Encouraging or instructing self-harm or suicide. Talking about one's own struggles is NOT blocked — it is a support case, not a violation.",
    enforcement: "block",
    patterns: [
      /\b(you|u)\s+should\s+(kill\s+yourself|kys|end\s+your\s+life)\b/i,
      /\bkys\b/i,
      /\bhow\s+to\s+(kill\s+yourself|hang\s+yourself|overdose)\b/i,
    ],
  },
  {
    category: "illegal_goods",
    covers: "Solicitation of drug, weapon, stolen-account or forged-document transactions.",
    enforcement: "block",
    patterns: [
      /\b(sell|selling|buy|buying|order|ship)\w*\b[^.\n]{0,30}\b(cocaine|heroin|meth|mdma|fentanyl|ketamine|lsd)\b/i,
      /\b(guns?|rifles?|pistols?|ammo|silencers?|grenades?)\b[^.\n]{0,30}\b(for\s+sale|no\s+licen[cs]e|untraceable|no\s+papers)\b/i,
      /\b(fake|forged|stolen)\s+(passports?|ids?|id\s*cards?|driver'?s?\s+licen[cs]es?|credit\s*cards?)\b[^.\n]{0,30}\b(sale|sell|buy|cheap|order)\b/i,
    ],
  },
  {
    category: "scam_credentials",
    covers:
      "Phishing, credential and payment-secret harvesting, and obvious financial scams. Crawler Room never asks for and never accepts secrets.",
    enforcement: "block",
    patterns: [
      /\b(send|share|give|post|dm)\s+(me\s+)?(your\s+)?(password|passwords|seed\s*phrase|recovery\s*phrase|private\s*key|api\s*key|otp|2fa\s*code|verification\s*code|credit\s*card|cvv|social\s*security|ssn)\b/i,
      /\b(verify|confirm|validate)\s+your\s+(account|wallet)\b[^.\n]{0,40}\b(seed\s*phrase|private\s*key|password|otp)\b/i,
      /\bsend\s+\d+[^.\n]{0,20}\b(btc|eth|usdt|bitcoin)\b[^.\n]{0,30}\breceive\s+(double|2x|10x)\b/i,
    ],
  },
  {
    category: "doxxing",
    covers:
      "Publishing another person's private contact, address, document or payment data. Sharing one's own public link is allowed.",
    enforcement: "block",
    patterns: [
      /\b(his|her|their|this\s+guy'?s|this\s+girl'?s)\s+(home\s+)?(address|phone\s*number|passport|iban|credit\s*card|social\s*security)\s*(is|:)/i,
      /\b(doxx?(ing|ed)?)\b[^.\n]{0,20}\b(him|her|them|this\s+guy|this\s+girl)\b/i,
    ],
  },
  {
    category: "spam_injection",
    covers:
      "Bulk spam and attempts to steer the model. Injection attempts are neutralised at render time (quoted, escaped, banner-marked) rather than blocked, so the reader still sees what was written.",
    enforcement: "review",
    patterns: [],
  },
];

/** Public, code-near summary used by the docs gate and the safety page. */
export const UGC_POLICY_CATEGORIES = UGC_POLICY.map((rule) => rule.category);

export interface UgcCheck {
  ok: boolean;
  category?: UgcCategory;
}

/** Collapses look-alike characters so trivial obfuscation does not slip past. */
function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[0]/g, "o")
    .replace(/[1|!]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[4@]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/\s+/g, " ");
}

/** Pure classifier: returns the first blocking category, if any. */
export function classifyUgc(raw: unknown): UgcCheck {
  const value = typeof raw === "string" ? raw : "";
  if (!value.trim()) return { ok: true };
  const text = normalize(value);
  for (const rule of UGC_POLICY) {
    if (rule.enforcement !== "block") continue;
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) return { ok: false, category: rule.category };
    }
  }
  return { ok: true };
}

/**
 * Fail-closed write guard. Throws the stable public `POLICY_VIOLATION` error
 * without naming the pattern, the category internals or the offending
 * substring, so the response cannot be used to tune around the filter.
 */
export function assertSafeUgc(raw: unknown): void {
  if (!classifyUgc(raw).ok) {
    throw roomError(
      "POLICY_VIOLATION",
      "This content cannot be published in Crawler Room. Crawler Room is a general-audience space: sexual content, sexualisation of minors, threats, hate, self-harm encouragement, illegal-goods or credential solicitation and doxxing are not allowed.",
    );
  }
}

/**
 * Fields that are actually PUBLISHED, per `tool.action`.
 *
 * The write guard is deliberately action-aware. Only text that becomes visible
 * to other people is filtered:
 *
 * - Moderation report `details` are NEVER scanned. A reporter must be able to
 *   write "they asked me for my seed phrase" or describe a threat, otherwise
 *   the safety filter would block the safety mechanism. Report details stay
 *   capped at 500 characters and carry the do-not-add-personal-data hint.
 * - Read-only identifiers, search queries, cursors and handles used to look
 *   somebody up are not published content and are not scanned either.
 *
 * Any `tool.action` that is not listed publishes no user-authored text.
 */
export const PUBLISHED_UGC_FIELDS: Record<string, readonly string[]> = {
  "universal_room.send": ["text"],
  "public_room.send": ["text"],
  "public_room.update": ["room_name", "description"],
  "profile.update": ["display_name", "bio", "location"],
  "profile.change_handle": ["handle"],
  "communities_organizations.send_community": ["text"],
  "communities_organizations.create_community": ["title", "name", "description"],
  "communities_organizations.update_community": ["title", "name", "description"],
  "communities_organizations.create_organization": ["title", "name", "description"],
  "communities_organizations.update_organization": ["title", "name", "description"],
};

/** All fields that can ever be published, used by the contract tests. */
export const PUBLISHED_UGC_FIELD_NAMES = [
  ...new Set(Object.values(PUBLISHED_UGC_FIELDS).flat()),
].sort();

/** Fields that must never be treated as published content. */
export const NEVER_FILTERED_FIELDS = ["details", "query", "target_id", "username", "cursor"];

/**
 * Applies the fail-closed write guard to exactly the published fields of one
 * tool action. Everything else — report details, search queries, lookup
 * identifiers — passes through untouched.
 */
export function assertSafePublishedUgc(tool: string, data: unknown): void {
  if (!data || typeof data !== "object") return;
  const record = data as Record<string, unknown>;
  const action = typeof record["action"] === "string" ? record["action"] : "";
  const fields = PUBLISHED_UGC_FIELDS[`${tool}.${action}`];
  if (!fields) return;
  for (const field of fields) assertSafeUgc(record[field]);
}
