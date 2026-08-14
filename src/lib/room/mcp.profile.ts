/**
 * MCP tool descriptors for the social profile (view, edit, likes, analytics).
 * Registered alongside the core and personal-room tools in `mcp.ts`.
 */
import type { McpMeta } from "./identity";
import {
  handleBlockProfile,
  handleChangeHandle,
  handleGetProfile,
  handleLikeContent,
  handleProfileAnalytics,
  handleSetProfileImage,
  handleTrackProfileLink,
  handleUnlikeContent,
  handleUpdateProfile,
} from "./tools.profile";

type Json = Record<string, unknown>;

export interface ProfileToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  outputSchema: Json;
  annotations: Json;
  handler: (input: unknown, meta: McpMeta) => Promise<Json>;
  summary: (result: any) => string;
}

const OPEN_OUTPUT: Json = { type: "object", additionalProperties: true };

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
};
const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
  idempotentHint: false,
};

const likeInput: Json = {
  type: "object",
  properties: {
    target_type: { type: "string", enum: ["profile", "message", "image"] },
    target_id: {
      type: "string",
      description:
        "Bei profile das Handle (mit oder ohne @), bei message/image die ID aus der Raum- oder Profilausgabe.",
    },
  },
  required: ["target_type", "target_id"],
  additionalProperties: false,
};

function profileSummary(result: any): string {
  const p = result.profile ?? {};
  if (p.visibility === "private" && !p.is_owner) return String(result.message);

  const head = `${p.display_name} (@${p.handle})`;
  const line = [
    p.followers === null ? null : `${p.followers} followers`,
    `${p.following} following`,
    p.likes_received === null ? null : `${p.likes_received} likes`,
    `${p.people_here_now} people here now`,
  ]
    .filter(Boolean)
    .join(" · ");

  const banner = p.banner_image_url ? `\n![Banner](${p.banner_image_url})` : "";
  const avatar = p.profile_image_url ? `\n![Profilbild](${p.profile_image_url})` : "";
  const bio = p.bio ? `\n${p.bio}` : "";
  const meta = [p.location, p.external_url].filter(Boolean).join(" · ");

  const messages = (result.tabs?.messages ?? []) as any[];
  const images = (result.tabs?.images ?? []) as any[];
  const feed = messages.length
    ? `\n\n${messages.map((m) => `• ${m.alias}: ${m.text} (${m.likes} ♥)`).join("\n")}`
    : "\n\nNoch keine Nachrichten.";
  const pics = images.length
    ? `\n\n${images.map((i) => `![${i.alt_text || "Bild"}](${i.url}) — ${i.alias} (${i.likes} ♥)`).join("\n")}`
    : "";

  return `${head}${banner}${avatar}${bio}\n${meta}\n${line}${feed}${pics}`;
}

export const PROFILE_TOOLS: ProfileToolDefinition[] = [
  {
    name: "get_profile",
    title: "Profil ansehen",
    description:
      "Zeigt ein vollständiges Social-Media-Profil: Banner, Profilbild, Anzeigename, @handle, Bio, Ort, Link, Beitrittsdatum, Follower, Following, erhaltene Likes, Live-Anwesenheit sowie die Tabs Nachrichten, Bilder und Follower. Ohne username wird das eigene Profil gezeigt (mit Bearbeitungsmöglichkeiten und Following-Liste).",
    inputSchema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "Handle der Person, mit oder ohne @. Weglassen für das eigene Profil.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: READ_ONLY,
    handler: (input, meta) => handleGetProfile(input, meta) as Promise<Json>,
    summary: profileSummary,
  },
  {
    name: "update_profile",
    title: "Profil bearbeiten",
    description:
      "Bearbeitet das eigene Profil: Anzeigename, Bio (max. 280 Zeichen), Ort, externer Link sowie Sichtbarkeit (öffentlich/privat) und die Schalter für Online-Status, Follower-Zahl und Likes. Nur der Besitzer kann sein Profil ändern.",
    inputSchema: {
      type: "object",
      properties: {
        display_name: { type: "string" },
        bio: { type: "string", description: "Max. 280 Zeichen." },
        location: { type: "string", description: "Max. 60 Zeichen." },
        external_url: { type: "string", description: "Eine Web-Adresse, z. B. sebklaey.app" },
        profile_visibility: { type: "string", enum: ["public", "private"] },
        show_online_status: { type: "boolean" },
        show_follower_count: { type: "boolean" },
        show_likes: { type: "boolean" },
      },
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleUpdateProfile(input, meta) as Promise<Json>,
    summary: (result) => `${result.message} ${profileSummary(result)}`,
  },
  {
    name: "change_handle",
    title: "Handle ändern",
    description:
      "Ändert das eigene @handle (3–30 Zeichen, Kleinbuchstaben, Zahlen, Unterstriche). Handles sind eindeutig; das alte Handle leitet automatisch weiter. Ist der Wunschname vergeben, kommen freie Vorschläge zurück.",
    inputSchema: {
      type: "object",
      properties: { handle: { type: "string" } },
      required: ["handle"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleChangeHandle(input, meta) as Promise<Json>,
    summary: (result) => String(result.message),
  },
  {
    name: "set_profile_image",
    title: "Profilbild oder Banner setzen",
    description:
      "Setzt oder entfernt Profilbild (kind: avatar) oder Bannerbild (kind: banner). Das Bild wird von einer https-Adresse geladen, auf JPG/PNG/WebP und max. 10 MB geprüft und von Metadaten (EXIF/GPS) befreit. Mit remove: true wird das Bild gelöscht.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["avatar", "banner"] },
        image_url: { type: "string", description: "https-Adresse des Bildes." },
        remove: { type: "boolean" },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleSetProfileImage(input, meta) as Promise<Json>,
    summary: (result) => `${result.message}${result.url ? `\n![](${result.url})` : ""}`,
  },
  {
    name: "like_content",
    title: "Liken",
    description:
      "Liked ein Profil, eine Nachricht oder ein Bild. Ein Like pro Person und Inhalt; eigene Inhalte können nicht geliked werden.",
    inputSchema: likeInput,
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleLikeContent(input, meta) as Promise<Json>,
    summary: (result) => `${result.message} (${result.likes} ♥)`,
  },
  {
    name: "unlike_content",
    title: "Like zurücknehmen",
    description: "Entfernt ein zuvor gesetztes Like von einem Profil, einer Nachricht oder einem Bild.",
    inputSchema: likeInput,
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleUnlikeContent(input, meta) as Promise<Json>,
    summary: (result) => `${result.message} (${result.likes} ♥)`,
  },
  {
    name: "profile_analytics",
    title: "Meine Profil-Statistik",
    description:
      "Nur für den Besitzer: Profilaufrufe, eindeutige Besuche, neue Follower, Entfolgungen, Likes, Nachrichten- und Bildaufrufe, Linkklicks, Raumbesuche, durchschnittliche Verweildauer, aktuelle Anwesenheit, Engagement-Rate, Tagesverlauf und Top-Inhalte. Keine Identitäten anderer Personen.",
    inputSchema: {
      type: "object",
      properties: { range_days: { type: "number", enum: [7, 30, 90] } },
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: READ_ONLY,
    handler: (input, meta) => handleProfileAnalytics(input, meta) as Promise<Json>,
    summary: (result) =>
      `@${result.handle} · ${result.range_days} Tage: ${result.profile_views} Profilaufrufe (${result.unique_visitors} eindeutig), ${result.new_followers} neue Follower, ${result.likes} Likes, ${result.link_clicks} Linkklicks, ${result.online_now} gerade anwesend, Engagement ${result.engagement_rate_percent}%.`,
  },
  {
    name: "open_profile_link",
    title: "Profil-Link öffnen",
    description:
      "Gibt den externen Link eines Profils zurück und zählt den Klick für die Statistik des Besitzers.",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string" } },
      required: ["username"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleTrackProfileLink(input, meta) as Promise<Json>,
    summary: (result) => (result.url ? `Link: ${result.url}` : "Dieses Profil hat keinen Link hinterlegt."),
  },
  {
    name: "block_profile",
    title: "Person blockieren",
    description:
      "Blockiert eine Person: ihr Profil ist für dich nicht mehr sichtbar und deines nicht mehr für sie.",
    inputSchema: {
      type: "object",
      properties: { username: { type: "string" }, reason: { type: "string" } },
      required: ["username"],
      additionalProperties: false,
    },
    outputSchema: OPEN_OUTPUT,
    annotations: WRITE,
    handler: (input, meta) => handleBlockProfile(input, meta) as Promise<Json>,
    summary: (result) => String(result.message),
  },
];
