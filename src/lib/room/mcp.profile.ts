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

/** Renders a ready-to-display Markdown profile card (banner + avatar + metrics). */
function profileSummary(result: any): string {
  const p = result.profile ?? {};
  if (p.visibility === "private" && !p.is_owner) return String(result.message);

  const parts: string[] = [];

  if (p.banner_image_url) parts.push(`![Banner von @${p.handle}](${p.banner_image_url})`);
  if (p.profile_image_url) parts.push(`![Profilbild von @${p.handle}](${p.profile_image_url})`);

  parts.push(`## ${p.display_name}\n**@${p.handle}**`);
  if (p.bio) parts.push(`> ${String(p.bio).replace(/\n/g, "\n> ")}`);

  const meta = [
    p.location ? `📍 ${p.location}` : null,
    p.external_url ? `🔗 [${p.external_url}](${/^https?:\/\//.test(p.external_url) ? p.external_url : `https://${p.external_url}`})` : null,
    p.joined_at ? `📅 seit ${String(p.joined_at).slice(0, 10)}` : null,
  ].filter(Boolean);
  if (meta.length) parts.push(meta.join(" · "));

  const stats: Array<[string, unknown]> = [];
  if (p.followers !== null && p.followers !== undefined) stats.push(["Followers", p.followers]);
  stats.push(["Following", p.following ?? 0]);
  if (p.likes_received !== null && p.likes_received !== undefined) stats.push(["Likes", p.likes_received]);
  stats.push(["Jetzt hier", `🟢 ${p.people_here_now ?? 0}`]);
  parts.push(
    `| ${stats.map(([label]) => label).join(" | ")} |\n|${stats.map(() => "---:").join("|")}|\n| ${stats
      .map(([, value]) => `**${value}**`)
      .join(" | ")} |`,
  );

  const messages = (result.tabs?.messages ?? []) as any[];
  const images = (result.tabs?.images ?? []) as any[];

  parts.push(
    `### 💬 Nachrichten\n${
      messages.length
        ? messages.map((m) => `- **${m.alias}**: ${m.text}  ♥ ${m.likes}`).join("\n")
        : "_Noch keine Nachrichten._"
    }`,
  );

  if (images.length) {
    parts.push(
      `### 🖼️ Bilder\n${images
        .map((i) => `![${i.alt_text || "Bild"}](${i.url})\n_${i.alias} · ♥ ${i.likes}_`)
        .join("\n\n")}`,
    );
  }

  return parts.join("\n\n");
}

/** Simple text bar chart for analytics rendering inside chat. */
function bar(value: number, max: number, width = 20): string {
  if (max <= 0) return "░".repeat(width);
  const filled = Math.max(value > 0 ? 1 : 0, Math.round((value / max) * width));
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

function analyticsSummary(result: any): string {
  const metrics: Array<[string, number]> = [
    ["Profilaufrufe", result.profile_views ?? 0],
    ["Eindeutige Besuche", result.unique_visitors ?? 0],
    ["Neue Follower", result.new_followers ?? 0],
    ["Entfolgungen", result.unfollows ?? 0],
    ["Likes", result.likes ?? 0],
    ["Nachrichtenaufrufe", result.message_views ?? 0],
    ["Bildaufrufe", result.image_views ?? 0],
    ["Linkklicks", result.link_clicks ?? 0],
    ["Raumbesuche", result.room_visits ?? 0],
  ];
  const max = Math.max(1, ...metrics.map(([, v]) => v));

  const chart = metrics
    .map(([label, value]) => `${label.padEnd(20, " ")} ${bar(value, max)} ${value}`)
    .join("\n");

  const daily = (result.daily ?? []) as any[];
  const dayValues = daily.map((d) => Number(d.profile_view ?? 0));
  const dayMax = Math.max(1, ...dayValues);
  const trend = daily.length
    ? daily
        .slice(-14)
        .map((d, i) => `${String(d.day).slice(5)}  ${bar(Number(d.profile_view ?? 0), dayMax, 16)} ${dayValues.slice(-14)[i] ?? 0}`)
        .join("\n")
    : "Noch keine Daten in diesem Zeitraum.";

  return [
    `## 📊 Statistik für @${result.handle} · ${result.range_days} Tage`,
    "```text",
    chart,
    "```",
    `**Engagement:** ${result.engagement_rate_percent}% · **Ø Verweildauer:** ${result.average_visit_seconds}s · **Gerade anwesend:** 🟢 ${result.online_now} · **Follower gesamt:** ${result.followers_total} · **Likes gesamt:** ${result.likes_total}`,
    "### Profilaufrufe pro Tag",
    "```text",
    trend,
    "```",
  ].join("\n\n");
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
    summary: analyticsSummary,
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
