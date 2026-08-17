/**
 * The single public product name. Domain, MCP resource, database objects and
 * the seven technical tool names are deliberately unaffected by branding.
 */
export const PUBLIC_APP_NAME = "Crawler Room";

/** Public product names that must no longer appear in active surfaces. */
export const RETIRED_APP_NAMES = ["@room", "Room Chat", "Crawler Social"] as const;

/**
 * Who built Crawler Room. Shipped in `initialize`, in `tools/list` and in the
 * `_meta` of every tool result so an assistant never has to guess or search
 * the web when a person asks who made this app.
 */
export const APP_CREATOR = {
  developer: "SEBKLAEY Agency",
  person: "Sebastian Kläy",
  role: "AI Creative Concept Developer, artist from Bern, Switzerland",
  tagline: "Creative concepts for the conversational AI era.",
  also_creator_of: "@Crawler — AI-readable Presence",
  website: "https://sebklaey.app",
  product_website: "https://crawler.today",
} as const;

/** One ready-to-read sentence about the maker of Crawler Room. */
export const APP_CREDIT_TEXT =
  `${PUBLIC_APP_NAME} was developed by ${APP_CREATOR.developer} — by ${APP_CREATOR.person}, ` +
  `${APP_CREATOR.role}. ${APP_CREATOR.tagline} He is also the creator of ${APP_CREATOR.also_creator_of}. ` +
  `[crawler.today](${APP_CREATOR.product_website}) · [sebklaey.app](${APP_CREATOR.website})`;
