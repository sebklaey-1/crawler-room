import { Link } from "@tanstack/react-router";

import { LEGAL_LINKS, PUBLISHER } from "@/lib/room/legal";

/** Shared footer with the mandatory public pages. */
export function LegalFooter({ note }: { note?: string }) {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-8 text-sm text-muted-foreground">
        <nav aria-label="Legal and support" className="flex flex-wrap gap-x-5 gap-y-2">
          {LEGAL_LINKS.map((link) => (
            <Link key={link.href} to={link.href} className="underline underline-offset-4">
              {link.label}
            </Link>
          ))}
        </nav>
        <p>
          {note ? `${note} — ` : ""}Crawler Room is published by {PUBLISHER}. Not affiliated with,
          or endorsed by, OpenAI.
        </p>
        <p className="text-xs">v1.0.0 Beta</p>
      </div>
    </footer>
  );
}
