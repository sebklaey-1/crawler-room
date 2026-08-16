/**
 * Ready-to-display Markdown renderers for chat surfaces.
 * The assistant is instructed to output these strings verbatim so that banner,
 * avatar and charts appear as real images / text graphics.
 */

export function profileCard(result: any): string {
  const p = result.profile ?? {};
  if (p.visibility === "private" && !p.is_owner) return String(result.message ?? "Dieses Profil ist privat.");

  const parts: string[] = [];

  if (p.banner_image_url) parts.push(`![Banner von @${p.handle}](${p.banner_image_url})`);
  if (p.profile_image_url) parts.push(`![Profilbild von @${p.handle}](${p.profile_image_url})`);

  parts.push(`## ${p.display_name}\n**@${p.handle}**`);
  if (p.bio) parts.push(`> ${String(p.bio).replace(/\n/g, "\n> ")}`);

  const meta = [
    p.location ? `📍 ${p.location}` : null,
    p.external_url
      ? `🔗 [${p.external_url}](${/^https?:\/\//.test(p.external_url) ? p.external_url : `https://${p.external_url}`})`
      : null,
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

function bar(value: number, max: number, width = 20): string {
  if (max <= 0) return "░".repeat(width);
  const filled = Math.max(value > 0 ? 1 : 0, Math.round((value / max) * width));
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

export function analyticsCard(result: any): string {
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

  const daily = (result.daily ?? []) as any[];
  const dayValues = daily.map((entry) => Number(entry.profile_view ?? 0));
  const dayMax = Math.max(1, ...dayValues);
  const trend = daily.length
    ? daily
        .slice(-14)
        .map(
          (entry, index) =>
            `${String(entry.day).slice(5)}  ${bar(Number(entry.profile_view ?? 0), dayMax, 16)} ${
              dayValues.slice(-14)[index] ?? 0
            }`,
        )
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
