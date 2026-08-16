/**
 * Alias handling: sanitize user-provided aliases and generate friendly
 * anonymous names.
 *
 * Two different things are called "alias" here:
 * - Automatically generated contextual aliases (`generateAlias`) are purely
 *   display-oriented per context and are never registered globally.
 * - Explicitly chosen public user names (display names) ARE globally unique:
 *   uniqueness is enforced atomically by the database name registry
 *   (`name_claims` / `normalize_alias`). `aliasKey` only mirrors that
 *   normalisation for UX pre-checks; the database stays the authority.
 */

export const MAX_ALIAS_LENGTH = 32;

const ADJECTIVES = [
  "Blue",
  "Quiet",
  "Green",
  "Silver",
  "Warm",
  "Bright",
  "Calm",
  "Golden",
  "Soft",
  "Clever",
  "Amber",
  "Swift",
  "Gentle",
  "Violet",
  "Sunny",
  "Copper",
];

const ANIMALS = [
  "Lynx",
  "Fox",
  "Owl",
  "Panda",
  "Otter",
  "Heron",
  "Falcon",
  "Deer",
  "Badger",
  "Raven",
  "Seal",
  "Ibex",
  "Marten",
  "Crane",
  "Hare",
  "Bison",
];

/**
 * Removes control characters, HTML, invisible unicode and overlong input.
 * Returns null when nothing safe remains.
 */
export function sanitizeAlias(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .normalize("NFKC")
    // strip tags first so "<b>Lea</b>" becomes "Lea"
    .replace(/<[^>]*>/g, " ")
    // control chars + invisible/bidi characters
    // eslint-disable-next-line no-control-regex -- intentional control/bidi character sanitiser
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    // only letters, numbers, spaces, hyphens, apostrophes, dots
    .replace(/[^\p{L}\p{N} \-'.]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, MAX_ALIAS_LENGTH).join("").trim() || null;
}

/**
 * Case-insensitive uniqueness key for a chosen public user name. Mirrors the
 * database function `public.normalize_alias` exactly: NFKC, trimmed, collapsed
 * whitespace, 1–32 characters, lowercased. The database stays the authority —
 * this is only used for UX pre-checks and suggestions.
 */
export function aliasKey(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!value || Array.from(value).length > MAX_ALIAS_LENGTH) return null;
  return value.toLowerCase();
}

/** Deterministic, stable anonymous alias derived from a seed (subject hash + topic). */
export function generateAlias(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const adjective = ADJECTIVES[hash % ADJECTIVES.length]!;
  const animal = ANIMALS[Math.floor(hash / ADJECTIVES.length) % ANIMALS.length]!;
  return `${adjective} ${animal}`;
}
