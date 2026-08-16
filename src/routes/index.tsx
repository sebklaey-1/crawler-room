import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "@room — anonymous rooms, profiles and communities in ChatGPT" },
      {
        name: "description",
        content:
          "@room connects people inside ChatGPT: an open Universal Room, permanent personal public rooms, social profiles, followers, likes, analytics, communities and organisations.",
      },
      { property: "og:title", content: "@room — anonymous rooms and profiles in ChatGPT" },
      {
        property: "og:description",
        content:
          "Universal Room, personal public rooms, social profiles, followers, likes, analytics, communities and organisations — pseudonymous and free.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

interface Health {
  status: string;
  version: string;
  database: string;
}

const AREAS = [
  {
    name: "Universal Room",
    body: "One open public room for everyone. Enter, read along and write — messages appear whenever you ask.",
  },
  {
    name: "Personal public rooms",
    body: "Everyone gets one permanent public room named after their handle. Others can open it, read it and write in it.",
  },
  {
    name: "Social profiles",
    body: "Banner, profile picture, display name, @handle, bio, location and link — shown as a real card inside ChatGPT.",
  },
  {
    name: "Followers and notifications",
    body: "Follow rooms you care about. Notifications are pull-based and appear the next time you talk to @room.",
  },
  {
    name: "Likes",
    body: "Like profiles, messages and images. One like per person and item; your own content is not likeable.",
  },
  {
    name: "Analytics",
    body: "Your own profile statistics as clear text charts — visible only to you, never with visitor identities.",
  },
  {
    name: "Communities and organisations",
    body: "Public community rooms, optionally owned by an organisation with members and roles.",
  },
] as const;

const STEPS = [
  {
    title: "Say hello",
    body: "Type “@room” in ChatGPT. You land in the Universal Room and immediately see what people are saying.",
  },
  {
    title: "Your own room",
    body: "Say “@room my room”. Your permanent public room already exists — no sign-up, no login.",
  },
  {
    title: "Your profile",
    body: "Set a display name, bio, banner and profile picture. Others open it with “@room open @handle”.",
  },
  {
    title: "Follow and like",
    body: "Follow rooms, like messages and images. Everything stays pseudonymous.",
  },
  {
    title: "Communities",
    body: "Create a public community or join one, and gather people around a shared subject.",
  },
];

const PRIVACY = [
  "No separate login: you are recognised pseudonymously through your ChatGPT identifier.",
  "That identifier is only ever stored as a hash — never in plain text.",
  "Profiles are pseudonymous and public by choice; you decide what a visitor sees.",
  "Rooms keep only recent content — older messages and images are deleted automatically.",
  "Images stay private, are stripped of EXIF/GPS data and are published only after a safety review.",
  "Analytics show counts only — never who visited you.",
  "Everything can be reported, and any profile can be blocked.",
];

function Landing() {
  const { data, isLoading } = useQuery<Health>({
    queryKey: ["health"],
    queryFn: async () => {
      const response = await fetch("/api/public/health");
      return (await response.json()) as Health;
    },
    retry: false,
  });

  const online = data?.status === "ok";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="text-lg font-semibold tracking-tight">@room</span>
        <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          <span
            className={`h-2 w-2 rounded-full ${
              isLoading ? "bg-muted-foreground" : online ? "bg-chart-2" : "bg-destructive"
            }`}
            aria-hidden
          />
          {isLoading ? "Checking status" : online ? "Service online" : "Service disrupted"}
        </span>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24">
        <section className="py-14 sm:py-20">
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            @room connects people through the Universal Room, personal rooms and profiles.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            An anonymous social layer that lives entirely inside ChatGPT: open rooms, your own
            permanent public room, a real profile, followers, likes, analytics and communities. No
            separate login, completely free.
          </p>
          <div className="mt-8 rounded-xl border border-border bg-card p-5 font-mono text-sm text-card-foreground">
            <p className="text-muted-foreground">In ChatGPT:</p>
            <p className="mt-2">@room</p>
            <p>@room my room</p>
            <p>@room open @handle</p>
          </div>
        </section>

        <section className="border-t border-border py-14">
          <h2 className="text-2xl font-semibold tracking-tight">What @room is</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AREAS.map((area) => (
              <div key={area.name} className="rounded-lg border border-border bg-card p-5">
                <h3 className="text-lg font-semibold">{area.name}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{area.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 border-t border-border py-14 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <div key={step.title}>
              <span className="text-sm font-medium text-muted-foreground">0{index + 1}</span>
              <h2 className="mt-2 text-lg font-semibold">{step.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </section>

        <section className="border-t border-border py-14">
          <h2 className="text-2xl font-semibold tracking-tight">Privacy</h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {PRIVACY.map((item) => (
              <li key={item} className="rounded-lg border border-border bg-card p-4 text-sm">
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted-foreground">
            Messages, images and bios from other people are third-party content. Never share
            personal data there.
          </p>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-muted-foreground">
          @room {data?.version ? `v${data.version}` : ""} — anonymous rooms, profiles and
          communities.
        </div>
      </footer>
    </div>
  );
}
