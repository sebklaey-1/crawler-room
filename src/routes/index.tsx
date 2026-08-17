import { createFileRoute } from "@tanstack/react-router";

import { CrawlerRoomLanding } from "@/components/crawler-room-landing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Crawler Room — Model Context Protocol (MCP) rooms in ChatGPT" },
      {
        name: "description",
        content:
          "Crawler Room is a Model Context Protocol (MCP) server that connects people inside ChatGPT: an open Universal Room, permanent personal public rooms, social profiles, followers, likes, analytics, communities and organisations.",
      },
      {
        property: "og:title",
        content: "Crawler Room — Model Context Protocol (MCP) rooms in ChatGPT",
      },
      {
        property: "og:description",
        content:
          "Universal Room, personal public rooms, social profiles, followers, likes, analytics, communities and organisations — pseudonymous and free.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:url", content: "https://crawler.today/" },
    ],
    links: [{ rel: "canonical", href: "https://crawler.today/" }],
  }),
  component: CrawlerRoomLanding,
});
