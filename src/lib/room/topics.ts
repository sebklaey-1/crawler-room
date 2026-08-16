/**
 * Controlled topic normalization. No fuzzy matching in the MVP.
 * 1. Unicode NFKC  2. trim  3. collapse whitespace  4. lowercase  5. alias table
 */

export const CANONICAL_TOPICS = [
  {
    slug: "ai",
    display_name: "AI",
    description: "Künstliche Intelligenz, Modelle und AI-Produkte",
  },
  { slug: "art", display_name: "Art", description: "Kunst, Illustration, Design und Kreativität" },
  {
    slug: "science",
    display_name: "Science",
    description: "Wissenschaft, Forschung und Entdeckungen",
  },
  { slug: "tech", display_name: "Tech", description: "Technologie, Software und Hardware" },
  { slug: "music", display_name: "Music", description: "Musik, Produktion und Instrumente" },
  { slug: "gaming", display_name: "Gaming", description: "Games, Entwicklung und Gaming-Kultur" },
  {
    slug: "life",
    display_name: "Life",
    description: "Alltag, persönliche Interessen und lockerer Austausch",
  },
] as const;

/** Static alias map, mirrored by the `topic_aliases` table. */
export const TOPIC_ALIASES: Record<string, string> = {
  ki: "ai",
  "künstliche intelligenz": "ai",
  "artificial intelligence": "ai",
  kunst: "art",
  sience: "science",
  wissenschaft: "science",
  technology: "tech",
  technologie: "tech",
  musik: "music",
  spiele: "gaming",
  leben: "life",
};

export function normalizeTopicInput(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Resolves a user-provided topic string to a canonical slug.
 * Returns null when the topic is unknown (caller emits TOPIC_NOT_FOUND).
 */
export function resolveTopicSlug(
  raw: string,
  aliases: Record<string, string> = TOPIC_ALIASES,
): string | null {
  const normalized = normalizeTopicInput(raw);
  if (!normalized) return null;
  if (CANONICAL_TOPICS.some((topic) => topic.slug === normalized)) return normalized;
  const byDisplayName = CANONICAL_TOPICS.find(
    (topic) => topic.display_name.toLowerCase() === normalized,
  );
  if (byDisplayName) return byDisplayName.slug;
  return aliases[normalized] ?? null;
}
