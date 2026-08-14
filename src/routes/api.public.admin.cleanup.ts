import { createFileRoute } from "@tanstack/react-router";

/**
 * Retention job: deletes expired messages and anonymizes stale memberships.
 * Protected by a constant-time comparison against ADMIN_TOKEN.
 */
export const Route = createFileRoute("/api/public/admin/cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided =
          request.headers.get("x-admin-token") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const expected = process.env["ADMIN_TOKEN"] ?? "";

        const { safeEqual } = await import("@/lib/room/crypto");
        if (!expected || !safeEqual(expected, provided)) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        try {
          const { getDb } = await import("@/lib/room/store");
          const db = await getDb();
          const { data, error } = await db.rpc("cleanup_expired");
          if (error) throw error;
          return new Response(JSON.stringify({ ok: true, result: data ?? {} }), {
            headers: { "content-type": "application/json" },
          });
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "cleanup_failed" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
