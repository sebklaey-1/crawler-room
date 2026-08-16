import { createFileRoute } from "@tanstack/react-router";

/**
 * Retention job: deletes expired messages, enforces the storage deletion
 * queue and anonymizes stale memberships. Called every 15 minutes by the
 * database scheduler with the vault-generated cleanup token, or manually with
 * `ADMIN_TOKEN`. Both are compared constant-time; no token value is logged.
 */
export const Route = createFileRoute("/api/public/admin/cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });

        const { authorizeCleanup, startMaintenanceRun, finishMaintenanceRun } = await import(
          "@/lib/room/maintenance"
        );
        const { getDb } = await import("@/lib/room/store");

        let db: Awaited<ReturnType<typeof getDb>> | null = null;
        try {
          db = await getDb();
        } catch {
          db = null;
        }

        if (!(await authorizeCleanup(db, request))) {
          return json({ error: "unauthorized" }, 401);
        }
        if (!db) return json({ ok: false, error: "cleanup_failed" }, 500);

        const runId = await startMaintenanceRun(db);
        try {
          const { sweepImages } = await import("@/lib/room/imagestore");
          const { data, error } = await db.rpc("cleanup_expired");
          if (error) throw error;
          const images = await sweepImages(db);
          const counters = {
            ...(typeof data === "object" && data ? (data as Record<string, number>) : {}),
            images_purged: images.purged,
            images_retention: images.retention,
            queue_removed: images.queue,
            queue_failed: images.queueFailed,
          };
          await finishMaintenanceRun(
            db,
            runId,
            images.queueFailed > 0 ? "failed" : "ok",
            counters,
            images.queueFailed > 0 ? "storage_retry_pending" : undefined,
          );
          return json({ ok: true, result: data ?? {}, images });
        } catch {
          await finishMaintenanceRun(db, runId, "failed", {}, "cleanup_failed");
          return json({ ok: false, error: "cleanup_failed" }, 500);
        }
      },
    },
  },
});
