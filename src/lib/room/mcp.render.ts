/**
 * Ready-to-display Markdown renderers for chat surfaces.
 * The assistant is instructed to output these strings verbatim so that banner,
 * avatar and charts appear as real images / text graphics.
 *
 * Everything a person typed — display name, bio, location, link, message text,
 * alt text, alias — is untrusted UGC and is escaped before it is rendered.
 * Only server-issued signed image URLs are emitted as active Markdown images.
 */
import { quoteUgcLine, sanitizeUgcLabel, sanitizeUgcText, UGC_BANNER } from "./ugc";
import type { DailyPoint, ImageView, MessageView, ProfileView, SummaryResult } from "./viewtypes";

/** Escapes a URL and only allows https targets produced by the server. */
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return encodeURI(url.toString());
  } catch {
    return null;
  }
}

export function profileCard(result: SummaryResult): string {
  const p: ProfileView = result.profile ?? {};
  if (p.visibility === "private" && !p.is_owner)
    return String(result.message ?? "Dieses Profil ist privat.");

  const parts: string[] = [];

  const handle = sanitizeUgcLabel(p.handle);
  const banner = safeUrl(p.banner_image_url);
  const avatar = safeUrl(p.profile_image_url);
  if (banner) parts.push(`![Banner von @${handle}](${banner})`);
  if (avatar) parts.push(`![Profilbild von @${handle}](${avatar})`);

  parts.push(`## ${sanitizeUgcLabel(p.display_name)}\n**@${handle}**`);
  if (p.bio) parts.push(`${UGC_BANNER}\n> ${sanitizeUgcText(p.bio, 500).replace(/\n/g, "\n> ")}`);

  const externalUrl = safeUrl(p.external_url);
  const meta = [
    p.location ? `📍 ${sanitizeUgcText(p.location, 60)}` : null,
    externalUrl ? `🔗 ${externalUrl}` : null,
    p.joined_at ? `📅 seit ${String(p.joined_at).slice(0, 10)}` : null,
  ].filter(Boolean);
  if (meta.length) parts.push(meta.join(" · "));

  const stats: Array<[string, unknown]> = [];
  if (p.followers !== null && p.followers !== undefined) stats.push(["Followers", p.followers]);
  stats.push(["Following", p.following ?? 0]);
  if (p.likes_received !== null && p.likes_received !== undefined)
    stats.push(["Likes", p.likes_received]);
  stats.push(["Jetzt hier", `🟢 ${p.people_here_now ?? 0}`]);
  parts.push(
    `| ${stats.map(([label]) => label).join(" | ")} |\n|${stats.map(() => "---:").join("|")}|\n| ${stats
      .map(([, value]) => `**${value}**`)
      .join(" | ")} |`,
  );

  const messages: MessageView[] = result.tabs?.messages ?? [];
  const images: ImageView[] = result.tabs?.images ?? [];

  parts.push(
    `### 💬 Nachrichten\n${
      messages.length
        ? `${UGC_BANNER}\n${messages
            .map(
              (m: MessageView) => `${quoteUgcLine(m.alias ?? "", m.text ?? "")}  ♥ ${m.likes ?? 0}`,
            )
            .join("\n")}`
        : "_Noch keine Nachrichten._"
    }`,
  );

  if (images.length) {
    parts.push(
      `### 🖼️ Bilder\n${images
        .map((i: ImageView) => {
          const url = safeUrl(i.url);
          const caption = `_${sanitizeUgcLabel(i.alias ?? "")} · ♥ ${i.likes ?? 0}_`;
          return url ? `![Bild](${url})\n${caption}` : caption;
        })
        .join("\n\n")}`,
    );
  }

  return parts.join("\n\n");
}

function bar(value: number, max: number, width = 20): string {
  if (max <= 0) return "░".repeat(width);
  const filled = Math.max(value > 0 ? 1 : 0, Math.round((value / max) * width));
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

export function analyticsCard(result: SummaryResult): string {
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
  const max = Math.max(1, ...metrics.map(([, value]) => value));

  const chart = metrics
    .map(([label, value]) => `${label.padEnd(20, " ")} ${bar(value, max)} ${value}`)
    .join("\n");

  const daily: DailyPoint[] = result.daily ?? [];
  const dayValues = daily.map((entry: DailyPoint) => Number(entry.profile_view ?? 0));
  const dayMax = Math.max(1, ...dayValues);
  const trend = daily.length
    ? daily
        .slice(-14)
        .map(
          (entry: DailyPoint, index: number) =>
            `${String(entry.day).slice(5)}  ${bar(Number(entry.profile_view ?? 0), dayMax, 16)} ${
              dayValues.slice(-14)[index] ?? 0
            }`,
        )
        .join("\n")
    : "Noch keine Daten in diesem Zeitraum.";

  return [
    `## 📊 Statistik für @${sanitizeUgcLabel(result.handle ?? "")} · ${result.range_days ?? 0} Tage`,
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
