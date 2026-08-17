/**
 * Shared Crawler Room landing/documentation page.
 *
 * Rendered identically by `/` and by the canonical documentation alias
 * `/crawler-room` (the `resource_documentation` value of the protected
 * resource metadata). No redirect is involved, so there is no redirect loop.
 */
import { useQuery } from "@tanstack/react-query";

import { Link } from "@tanstack/react-router";
import roomIcon from "@/assets/room-icon.png.asset.json";
import { LegalFooter } from "@/components/legal-footer";

interface Health {
  status: string;
  version: string;
  database: string;
}

const AREAS = [
  {
    name: "One Universal Room",
    body: "A single open public room for everyone. Enter, read along and write — the whole product, nothing else to learn.",
  },
  {
    name: "Automatic pseudonyms",
    body: "Every visitor is given a pseudonym by the server. No sign-in, no registration, no profile, no name to pick.",
  },
  {
    name: "24-hour memory",
    body: "The room keeps only its newest 7 messages and nothing older than 24 hours. Conversations stay in the moment.",
  },
  {
    name: "Live presence",
    body: "See how many people are in the room right now, counted live and shown as a number only.",
  },
  {
    name: "Reporting",
    body: "Any message can be reported for human review straight from the chat, with rate limits and spam checks on the server.",
  },
  {
    name: "Nothing collected",
    body: "No accounts, no profiles, no likes, no analytics, no images, no email address and no location — ever.",
  },
] as const;

const STEPS = [
  {
    title: "Say hello",
    body: "Type “Crawler Room” in ChatGPT. You land in the Universal Room and immediately see what people are saying.",
  },
  {
    title: "Write something",
    body: "Say “Crawler Room send: hi everyone”. Your message appears under your assigned pseudonym.",
  },
  {
    title: "Keep reading",
    body: "Ask again any time. ChatGPT reads the newest messages back to you and translates them into your language.",
  },
];

const PRIVACY = [
  "No account, no email, no password — identity is a server-side keyed hash you never see.",
  "Every message is public and disappears after 24 hours at the latest.",
  "Live presence is a count only — never a list of who is watching.",
  "Messages can be reported for human review, and every limit is enforced on the server.",
];

export function CrawlerRoomLanding() {
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
        <span className="flex items-center gap-3">
          <img
            src={roomIcon.url}
            alt="Crawler Room app icon: two glowing speech bubbles forming an infinity loop"
            width={40}
            height={40}
            className="h-10 w-10 rounded-xl"
          />
          <span className="text-lg font-semibold tracking-tight">Crawler Room</span>
        </span>
        <span className="flex items-center gap-3">
          <Link
            to="/install"
            className="inline-flex items-center rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground"
          >
            Install Beta
          </Link>
          <span className="hidden items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground sm:inline-flex">
            <span
              className={`h-2 w-2 rounded-full ${
                isLoading ? "bg-muted-foreground" : online ? "bg-chart-2" : "bg-destructive"
              }`}
              aria-hidden
            />
            {isLoading ? "Checking status" : online ? "Service online" : "Service disrupted"}
          </span>
        </span>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24">
        <section className="py-14 sm:py-20">
          <img
            src={roomIcon.url}
            alt="Crawler Room logo"
            width={96}
            height={96}
            className="mb-8 h-24 w-24 rounded-3xl shadow-lg"
          />
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            Crawler Room is a Model Context Protocol (MCP) server with one open, anonymous Universal
            Room inside ChatGPT.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            One public room, everyone anonymous under an assigned pseudonym, messages gone after 24
            hours. No login, no profile, completely free.
          </p>
          <div className="mt-8 rounded-xl border border-border bg-card p-5 font-mono text-sm text-card-foreground">
            <p className="text-muted-foreground">In ChatGPT:</p>
            <p className="mt-2">Crawler Room</p>
            <p>Crawler Room send: hello everyone</p>
            <p>Crawler Room read the latest messages</p>
          </div>
        </section>

        <section className="border-t border-border py-14">
          <h2 className="text-2xl font-semibold tracking-tight">What Crawler Room is</h2>
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
            Messages from other people are third-party content. Never share personal data there.
          </p>
        </section>
      </main>

      <LegalFooter
        note={`Crawler Room ${data?.version ? `v${data.version}` : ""} — one anonymous Universal Room`}
      />
    </div>
  );
}
