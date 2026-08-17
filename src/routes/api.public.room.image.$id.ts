/**
 * Public read-only image delivery.
 *
 * Serves exactly one kind of bytes: an approved, non-expired room image or the
 * avatar/banner of a personal room, addressed by a signed opaque id. The id is
 * unguessable and carries no internal reference; storage paths, bucket names
 * and database errors never leave this handler. Pending, rejected, failed or
 * expired images are not readable here.
 */
import { createFileRoute } from "@tanstack/react-router";

import { MAX_RETENTION_HOURS } from "@/lib/room/config";
import { decodeImageId, decodeProfileImageId } from "@/lib/room/ids";
import { downloadObject, getImageRow } from "@/lib/room/imagestore";
import { getDb } from "@/lib/room/store";

const HEADERS = {
  "access-control-allow-origin": "*",
  "cross-origin-resource-policy": "cross-origin",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
};

function notFound() {
  return new Response("Not found", { status: 404, headers: HEADERS });
}

function bytes(body: Uint8Array, mime: string, maxAge: number) {
  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: {
      ...HEADERS,
      "content-type": mime,
      "content-length": String(body.byteLength),
      "cache-control": `public, max-age=${maxAge}`,
    },
  });
}

export const Route = createFileRoute("/api/public/room/image/$id")({
  server: {
    handlers: {
      OPTIONS: () =>
        new Response(null, {
          status: 204,
          headers: { ...HEADERS, "access-control-allow-methods": "GET, OPTIONS" },
        }),
      GET: async ({ params }) => {
        const id = String((params as { id?: string }).id ?? "");
        const db = await getDb();

        const imageId = await decodeImageId(id);
        if (imageId !== null) {
          const row = await getImageRow(db, imageId);
          if (!row || !row.uploaded || row.moderation_status !== "approved") return notFound();
          const age = Date.now() - new Date(row.created_at).getTime();
          if (age > MAX_RETENTION_HOURS * 3600 * 1000) return notFound();
          const body = await downloadObject(db, row.storage_path);
          if (!body) return notFound();
          return bytes(body, row.mime_type || "image/jpeg", 600);
        }

        const profileImage = await decodeProfileImageId(id);
        if (profileImage) {
          const { data } = await db
            .from("user_rooms")
            .select("avatar_path, banner_path")
            .eq("room_id", profileImage.roomId)
            .maybeSingle();
          const path =
            profileImage.kind === "avatar"
              ? ((data as { avatar_path?: string | null } | null)?.avatar_path ?? null)
              : ((data as { banner_path?: string | null } | null)?.banner_path ?? null);
          if (!path) return notFound();
          const body = await downloadObject(db, path);
          if (!body) return notFound();
          const mime = path.endsWith(".png")
            ? "image/png"
            : path.endsWith(".webp")
              ? "image/webp"
              : "image/jpeg";
          return bytes(body, mime, 600);
        }

        return notFound();
      },
    },
  },
});
