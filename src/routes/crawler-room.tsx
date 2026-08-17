import { createFileRoute } from "@tanstack/react-router";

import { CrawlerRoomLanding } from "@/components/crawler-room-landing";

/**
 * `https://crawler.today/crawler-room` — the documentation URL advertised as
 * `resource_documentation` in the RFC 9728 protected-resource metadata.
 * It serves the landing/documentation page directly (HTTP 200, no redirect),
 * with the same product information, legal footer and support contact as `/`.
 */
export const Route = createFileRoute("/crawler-room")({
  head: () => ({
    meta: [
      { title: "Crawler Room documentation — MCP server, tools and privacy" },
      {
        name: "description",
        content:
          "Documentation for the Crawler Room MCP server on crawler.today: Universal Room, personal public rooms, profiles, followers, likes, analytics, communities, retention and support.",
      },
      { property: "og:title", content: "Crawler Room documentation" },
      {
        property: "og:description",
        content:
          "How Crawler Room works inside ChatGPT: rooms, profiles, safety, retention and the canonical MCP resource https://crawler.today/api/public/mcp.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://crawler.today/crawler-room" }],
  }),
  component: CrawlerRoomLanding,
});
