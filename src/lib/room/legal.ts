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
 * Public support contact. Configured through the public build variable
 * `VITE_PUBLIC_SUPPORT_EMAIL`. There is deliberately no invented fallback: if
 * the value is missing the pages show a neutral notice and `release:check`
 * reports a release blocker.
 */
export function publicSupportEmail(): string | null {
  const raw = import.meta.env?.["VITE_PUBLIC_SUPPORT_EMAIL"];
  const value = typeof raw === "string" ? raw.trim() : "";
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? value : null;
}
