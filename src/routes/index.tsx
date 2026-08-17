import { createFileRoute } from "@tanstack/react-router";

import { CrawlerRoomLanding } from "@/components/crawler-room-landing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Crawler Room — Model Context Protocol (MCP) rooms in ChatGPT" },
      {
        name: "description",
        content:
          "Crawler Room is a Model Context Protocol (MCP) server that connects people inside ChatGPT: one open, anonymous Universal Room with assigned pseudonyms and 24-hour retention.",
      },
      {
        property: "og:title",
        content: "Crawler Room — Model Context Protocol (MCP) rooms in ChatGPT",
      },
      {
        property: "og:description",
        content: "One open Universal Room inside ChatGPT — anonymous, pseudonymous and free.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:url", content: "https://crawler.today/" },
    ],
    links: [{ rel: "canonical", href: "https://crawler.today/" }],
  }),
  component: CrawlerRoomLanding,
});
