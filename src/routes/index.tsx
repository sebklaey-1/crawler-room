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
    title: "Catch up",
    body: "Just type “@room”. New messages appear when you ask; there are no push notifications.",
  },
];

const PRIVACY = [
  "No account, no sign-up, no profiles.",
  "Your ChatGPT identifier is only stored as a hash — never in plain text.",
  "Messages are deleted automatically after 24 hours.",
  "You only see messages posted in your room after you joined.",
  "Every message can be reported; rooms stay small and manageable.",
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
          <h2 className="text-2xl font-semibold tracking-tight">Themen</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Synonyme werden erkannt — „AI“, „KI“ und „künstliche Intelligenz“ führen in denselben
            Themenbereich.
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
          <h2 className="text-2xl font-semibold tracking-tight">Privatsphäre</h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {PRIVACY.map((item) => (
              <li key={item} className="rounded-lg border border-border bg-card p-4 text-sm">
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted-foreground">
            Nachrichten anderer Personen sind fremde Inhalte. Teile dort keine persönlichen Daten.
          </p>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-muted-foreground">
          @room {data?.version ? `v${data.version}` : ""} — anonyme Themenräume.
        </div>
      </footer>
    </div>
  );
}
