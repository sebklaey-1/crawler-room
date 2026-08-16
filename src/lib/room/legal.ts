/** Public legal / support pages, linked from the landing page and consent screen. */
export const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/support", label: "Support" },
  { href: "/safety", label: "Safety" },
  { href: "/data-deletion", label: "Data deletion" },
] as const;

export const PUBLISHER = "SEBKLAEY Agency — Sebastian Kläy";

/**
 * The confirmed public support, privacy, deletion and abuse contact. This
 * address is published on the legal pages, so it is not a secret and lives in
 * source as the single source of truth.
 */
export const SUPPORT_EMAIL = "info@crawler.today" as const;

/**
 * Public support contact. Always returns the canonical address. A build may
 * set `VITE_PUBLIC_SUPPORT_EMAIL`, but only to the exact same value; any other
 * value is ignored here and reported as an error by `release:check`.
 */
export function publicSupportEmail(): string {
  return SUPPORT_EMAIL;
}

/** True when no conflicting support address is configured for the build. */
export function supportEmailEnvMatches(configured: string | undefined | null): boolean {
  const value = typeof configured === "string" ? configured.trim() : "";
  return value === "" || value.toLowerCase() === SUPPORT_EMAIL;
}
