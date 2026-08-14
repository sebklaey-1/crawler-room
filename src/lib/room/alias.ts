/**
 * Alias handling: sanitize user-provided aliases, generate friendly anonymous
 * names. Aliases are display-only and need not be globally unique.
 */

export const MAX_ALIAS_LENGTH = 32;

const ADJECTIVES = [
  "Blue", "Quiet", "Green", "Silver", "Warm", "Bright", "Calm", "Golden",
  "Soft", "Clever", "Amber", "Swift", "Gentle", "Violet", "Sunny", "Copper",
];

const ANIMALS = [
  "Lynx", "Fox", "Owl", "Panda", "Otter", "Heron", "Falcon", "Deer",
  "Badger", "Raven", "Seal", "Ibex", "Marten", "Crane", "Hare", "Bison",
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
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    // only letters, numbers, spaces, hyphens, apostrophes, dots
    .replace(/[^\p{L}\p{N} \-'.]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, MAX_ALIAS_LENGTH).join("").trim() || null;
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
