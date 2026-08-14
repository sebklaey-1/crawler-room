import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "@room — anonyme Themenräume für ChatGPT" },
      {
        name: "description",
        content:
          "@room verbindet dich anonym mit bis zu vier weiteren Menschen in kleinen Themenräumen — direkt aus ChatGPT heraus.",
      },
      { property: "og:title", content: "@room — anonyme Themenräume für ChatGPT" },
      {
        property: "og:description",
        content:
          "Kleine Räume mit maximal fünf Personen, pseudonym, ohne Konto, mit 24-Stunden-Aufbewahrung.",
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
  "KI & Technik",
  "Kunst",
  "Wissenschaft",
  "Musik",
  "Bücher",
  "Reisen",
  "Gesundheit",
  "Alltag",
];

const STEPS = [
  {
    title: "Thema wählen",
    body: "Schreibe in ChatGPT „@room KI“. @room ordnet dich einem Raum mit höchstens fünf Personen zu.",
  },
  {
    title: "Schreiben",
    body: "„@room KI: Woran arbeitet ihr gerade?“ — deine Nachricht landet anonym im Raum.",
  },
  {
    title: "Nachlesen",
    body: "Schreibe einfach „@room“. Neue Nachrichten erscheinen beim Aufruf; es gibt keine Push-Nachrichten.",
  },
];

const PRIVACY = [
  "Kein Konto, keine Registrierung, keine Profile.",
  "Deine ChatGPT-Kennung wird nur als Hash gespeichert — niemals im Klartext.",
  "Nachrichten werden nach 24 Stunden automatisch gelöscht.",
  "Du siehst nur Nachrichten ab deinem Beitritt in deinen Raum.",
  "Jede Nachricht lässt sich melden; Räume bleiben klein und überschaubar.",
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
          {isLoading ? "Status wird geprüft" : online ? "Dienst erreichbar" : "Dienst gestört"}
        </span>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24">
        <section className="py-14 sm:py-20">
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            Kleine, anonyme Räume für ein Thema.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            @room ist ein ChatGPT-Plugin: Du wählst ein Thema, landest anonym in einem Raum mit
            maximal fünf Personen und schreibst dort — ohne Konto, ohne Profil, ohne Verlauf.
          </p>
          <div className="mt-8 rounded-xl border border-border bg-card p-5 font-mono text-sm text-card-foreground">
            <p className="text-muted-foreground">In ChatGPT:</p>
            <p className="mt-2">@room KI</p>
            <p>@room KI: Woran arbeitet ihr gerade?</p>
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
