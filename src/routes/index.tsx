import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "@room — anonymous topic rooms for ChatGPT" },
      {
        name: "description",
        content:
          "@room connects you anonymously with up to four other people in small topic rooms — right inside ChatGPT.",
      },
      { property: "og:title", content: "@room — anonymous topic rooms for ChatGPT" },
      {
        property: "og:description",
        content:
          "Small rooms with at most five people, pseudonymous, no account, 24-hour retention.",
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

const TOPIC_HINTS = [
  "AI",
  "Art",
  "Science",
  "Tech",
  "Music",
  "Gaming",
  "Life",
];

const EXTENSIONS = [
  {
    name: "Rooms",
    price: "Free",
    features: ["Join public rooms", "Universal Room access", "Text and reviewed images", "Rolling retention"],
  },
  {
    name: "Your own rooms",
    price: "Free",
    features: ["Personal room named after you", "Followers and live presence", "Secure invitations", "Room settings"],
  },
  {
    name: "Communities",
    price: "Free",
    features: ["Multiple communities", "Moderator roles", "Room analytics", "Listing placement"],
  },
  {
    name: "Organisations",
    price: "Free",
    features: ["Verified organisation", "Sponsored rooms", "Campaign analytics", "Team management"],
  },
] as const;


const STEPS = [
  {
    title: "Pick a topic",
    body: "Type “@room AI” in ChatGPT. @room places you in a room with at most five people.",
  },
  {
    title: "Write",
    body: "“@room AI: What are you working on right now?” — your message lands in the room anonymously.",
  },
  {
    title: "Share a picture",
    body: "Send an image in your room. It stays private until it passes a safety review — only then does the room see it.",
  },
  {
    title: "Your own room",
    body: "Say \u201c@rooms my room\u201d. Everyone gets one permanent public room named after them \u2014 no login. Others follow it with \u201c@rooms follow @you\u201d.",
  },
  {
    title: "Catch up",
    body: "Just type “@room”. New messages appear when you ask; there are no push notifications.",
  },
];

const PRIVACY = [
  "No account, no sign-up, no profiles.",
  "Your ChatGPT identifier is only stored as a hash — never in plain text.",
  "Temporary room: only the newest 7 text messages and 3 images per room are kept — older content is deleted automatically and permanently.",
  "Messages are deleted automatically after 24 hours.",
  "Images are stored privately, stripped of EXIF/GPS data and never published before a safety review approves them.",
  "You only see messages posted in your room after you joined.",
  "Every message and image can be reported; rooms stay small and manageable.",
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
            Small, anonymous rooms for one topic.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            @room is a ChatGPT plugin: pick a topic, land anonymously in a room with at most five
            people and talk there — no account, no profile, no history.
          </p>
          <div className="mt-8 rounded-xl border border-border bg-card p-5 font-mono text-sm text-card-foreground">
            <p className="text-muted-foreground">In ChatGPT:</p>
            <p className="mt-2">@room AI</p>
            <p>@room AI: What are you working on right now?</p>
            <p>@room</p>
          </div>

        </section>

        <section id="install" className="border-t border-border py-14">
          <h2 className="text-2xl font-semibold tracking-tight">Install @room in ChatGPT</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            @room is a custom MCP connector. ChatGPT only shows custom connectors when developer
            mode is enabled — switch it on first, then add the server URL below.
          </p>

          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <ol className="space-y-6">
              {INSTALL_STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium text-muted-foreground">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-base font-semibold">{step.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <figure className="rounded-xl border border-border bg-card p-3">
              <img
                src={pluginDialog.url}
                alt="ChatGPT dialog for adding a new plugin with the @room MCP server URL"
                loading="lazy"
                className="w-full rounded-lg"
              />
              <figcaption className="px-2 py-3 text-xs text-muted-foreground">
                The “New plugin” dialog in ChatGPT — connection set to Server URL, no
                authentication.
              </figcaption>
            </figure>
          </div>

          <div className="mt-8 rounded-xl border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">MCP server URL</p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <code className="flex-1 overflow-x-auto rounded-lg border border-border px-4 py-3 font-mono text-sm">
                {MCP_URL}
              </code>
              <button
                type="button"
                onClick={copyUrl}
                className="rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Authentication: none. ChatGPT will warn that custom MCP servers are unverified —
              confirm to continue.
            </p>
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
          <h2 className="text-2xl font-semibold tracking-tight">Topics</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Synonyms are recognised — “AI”, “KI” and “artificial intelligence” all lead to the same
            topic.
          </p>

          <ul className="mt-6 flex flex-wrap gap-2">
            {TOPIC_HINTS.map((topic) => (
              <li
                key={topic}
                className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground"
              >
                {topic}
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-border py-14">
          <h2 className="text-2xl font-semibold tracking-tight">Extensions</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            @room is completely free. No subscriptions, no plans, no prices — every extension is
            unlocked for everyone.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {EXTENSIONS.map((extension) => (
              <div key={extension.name} className="rounded-lg border border-border bg-card p-5">
                <h3 className="text-lg font-semibold">{extension.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{extension.price}</p>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  {extension.features.map((feature) => (
                    <li key={feature}>· {feature}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="mt-6 text-sm text-muted-foreground">
            Ask ChatGPT “show my @room options” to see what is unlocked. Sponsored rooms are always
            labelled as advertising, reviewed before publication, and can be hidden at any time.
          </p>
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
            Messages from other people are third-party content. Never share personal data there.
          </p>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-muted-foreground">
          @room {data?.version ? `v${data.version}` : ""} — anonymous topic rooms.

        </div>
      </footer>
    </div>
  );
}
