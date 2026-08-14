import { createFileRoute } from "@tanstack/react-router";

import { SERVICE_NAME, SERVICE_VERSION } from "@/lib/room/config";

/** Liveness/readiness probe. Reports database reachability without leaking details. */
export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        let database = "unknown";
        try {
          const { getDb } = await import("@/lib/room/store");
          const db = await getDb();
          const { error } = await db.from("topics").select("id", { count: "exact", head: true });
          database = error ? "error" : "ok";
        } catch {
          database = "error";
        }

        const ok = database === "ok";
        return new Response(
          JSON.stringify({
            status: ok ? "ok" : "degraded",
            service: SERVICE_NAME,
            version: SERVICE_VERSION,
            database,
            timestamp: new Date().toISOString(),
          }),
          {
            status: ok ? 200 : 503,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          },
        );
      },
    },
  },
});
