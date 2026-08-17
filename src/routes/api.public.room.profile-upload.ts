/**
 * Private upload target for profile images (avatar / banner).
 *
 * Authorised only by a short-lived, HMAC-signed `profile_upload` token that is
 * bound to one personal room and one image kind. The bytes are sniffed and
 * re-encoded without metadata before they are stored in the private bucket;
 * the response returns the stable public image URL.
 */
import { createFileRoute } from "@tanstack/react-router";

import { imageConfig } from "@/lib/room/config";
import { setProfileImageForRoom } from "@/lib/room/profile";
import { getDb } from "@/lib/room/store";
import { verifyToken } from "@/lib/room/tokens";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-room-upload-token",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

export const Route = createFileRoute("/api/public/room/profile-upload")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const settings = imageConfig();
        const claims = await verifyToken(
          request.headers.get("x-room-upload-token"),
          "profile_upload",
        );
        if (!claims?.roomId) return json({ error: "unauthorized" }, 401);

        const raw = new Uint8Array(await request.arrayBuffer());
        if (!raw.length) return json({ error: "empty_body" }, 400);
        if (raw.length > settings.maxImageBytes) return json({ error: "image_too_large" }, 413);

        const kind = claims.kind === "banner" ? "banner" : "avatar";
        try {
          const db = await getDb();
          const result = await setProfileImageForRoom(db, claims.roomId, kind, raw);
          return json({ uploaded: true, kind: result.kind, url: result.url });
        } catch {
          return json({ error: "image_rejected" }, 415);
        }
      },
    },
  },
});
