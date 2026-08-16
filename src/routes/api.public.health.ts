import { createFileRoute } from "@tanstack/react-router";

import { SERVICE_NAME, SERVICE_VERSION } from "@/lib/room/config";

/**
 * Liveness probe. Reports a minimal status only — no database names, no
 * environment values, no error details, no dependency diagnostics beyond a
 * generic ok/degraded flag.
 */
export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        let dependencies: "ok" | "degraded" = "degraded";
        try {
          const { getDb } = await import("@/lib/room/store");
          const db = await getDb();
          const { error } = await db.from("topics").select("id", { count: "exact", head: true });
          dependencies = error ? "degraded" : "ok";
        } catch {
          dependencies = "degraded";
        }

        const ok = dependencies === "ok";
        return new Response(
          JSON.stringify({
            status: ok ? "ok" : "degraded",
            service: SERVICE_NAME,
            version: SERVICE_VERSION,
            dependencies,
          }),
          {
            status: ok ? 200 : 503,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
              "referrer-policy": "no-referrer",
              "x-frame-options": "DENY",
            },
          },
        );
      },
    },
  },
});
