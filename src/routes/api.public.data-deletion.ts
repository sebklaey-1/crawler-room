import { createFileRoute } from "@tanstack/react-router";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

function fail(status: number, code: string) {
  return new Response(JSON.stringify({ ok: false, error: code }), {
    status,
    headers: JSON_HEADERS,
  });
}

/**
 * Verified deletion request. Requires a signed-in Supabase web session; the
 * bearer token is verified server-side and never stored. Nothing is deleted
 * immediately — a pending, auditable request is created instead.
 */
export const Route = createFileRoute("/api/public/data-deletion")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length > 4096) return fail(413, "payload_too_large");
        let payload: { note?: unknown } = {};
        if (raw.trim()) {
          try {
            payload = JSON.parse(raw) as { note?: unknown };
          } catch {
            return fail(400, "invalid_input");
          }
        }

        const header = request.headers.get("authorization") ?? "";
        const token = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim() ?? null;

        try {
          const { webSessionHash } = await import("@/lib/room/websession");
          const hash = await webSessionHash(token);
          if (!hash) return fail(401, "sign_in_required");

          const { getDb } = await import("@/lib/room/store");
          const { submitDeletionRequest, cleanupSupportData } = await import("@/lib/room/support");
          const db = await getDb();
          const result = await submitDeletionRequest(
            db,
            hash,
            typeof payload.note === "string" ? payload.note : undefined,
          );

          try {
            await cleanupSupportData(db);
          } catch {
            /* best effort */
          }

          return new Response(
            JSON.stringify({
              ok: true,
              reference: result.reference,
              status: result.status,
              duplicate: result.duplicate,
            }),
            { status: 200, headers: JSON_HEADERS },
          );
        } catch (error) {
          const code = (error as { code?: string })?.code;
          if (code === "INVALID_INPUT") return fail(400, "invalid_input");
          return fail(500, "internal_error");
        }
      },
    },
  },
});
