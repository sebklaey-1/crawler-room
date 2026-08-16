import { createFileRoute } from "@tanstack/react-router";

import { MAX_SUPPORT_BODY_BYTES } from "@/lib/room/support";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

function fail(status: number, code: string) {
  return new Response(JSON.stringify({ ok: false, error: code }), {
    status,
    headers: JSON_HEADERS,
  });
}

/**
 * Public support / abuse endpoint used by the /support page.
 * Validation, size limit, honeypot and rate limit run server-side.
 */
export const Route = createFileRoute("/api/public/support")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const declared = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
        if (Number.isFinite(declared) && declared > MAX_SUPPORT_BODY_BYTES) {
          return fail(413, "payload_too_large");
        }

        const raw = await request.text();
        if (new TextEncoder().encode(raw).length > MAX_SUPPORT_BODY_BYTES) {
          return fail(413, "payload_too_large");
        }

        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return fail(400, "invalid_input");
        }

        try {
          const { getDb } = await import("@/lib/room/store");
          const { submitSupportRequest, cleanupSupportData } = await import("@/lib/room/support");
          const db = await getDb();
          const fingerprint =
            request.headers.get("cf-connecting-ip") ??
            request.headers.get("x-forwarded-for") ??
            null;

          const result = await submitSupportRequest(db, payload, {
            requestFingerprint: fingerprint,
          });

          // Executed retention, not just an expiry column.
          try {
            await cleanupSupportData(db);
          } catch {
            /* retention is best effort and never blocks a report */
          }

          return new Response(
            JSON.stringify({ ok: true, reference: result.reference, received: true }),
            { status: 200, headers: JSON_HEADERS },
          );
        } catch (error) {
          const code = (error as { code?: string })?.code;
          if (code === "INVALID_INPUT") return fail(400, "invalid_input");
          if (code === "RATE_LIMITED") return fail(429, "rate_limited");
          return fail(500, "internal_error");
        }
      },
    },
  },
});
