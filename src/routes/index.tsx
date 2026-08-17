import { createFileRoute } from "@tanstack/react-router";

import { CrawlerRoomLanding } from "@/components/crawler-room-landing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Crawler Room — anonymous rooms, profiles and communities in ChatGPT" },
      {
        name: "description",
        content:
          "Crawler Room connects people inside ChatGPT: an open Universal Room, permanent personal public rooms, social profiles, followers, likes, analytics, communities and organisations.",
      },
      { property: "og:title", content: "Crawler Room — anonymous rooms and profiles in ChatGPT" },
      {
        property: "og:description",
        content:
          "Universal Room, personal public rooms, social profiles, followers, likes, analytics, communities and organisations — pseudonymous and free.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://crawler.today/" }],
  }),
  component: CrawlerRoomLanding,
});
