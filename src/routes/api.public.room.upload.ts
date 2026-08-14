/**
 * Private upload target for room images.
 *
 * Authorised only by a short-lived, HMAC-signed upload token that is bound to
 * one image record and one pseudonymous subject. The raw bytes are sniffed,
 * re-encoded without any metadata (EXIF/GPS included) and stored under a
 * random path in the private bucket. Nothing becomes visible here: the record
 * stays `pending` until the review step approves it.
 */
import { createFileRoute } from "@tanstack/react-router";

import { imageConfig } from "@/lib/room/config";
import { sha256Hex } from "@/lib/room/crypto";
import { ALLOWED_MIME, sanitizeImage } from "@/lib/room/images";
import {
  findDuplicate,
  getImageRow,
  removeStorageObjects,
  updateImageRow,
  uploadObject,
} from "@/lib/room/imagestore";
import { getDb } from "@/lib/room/store";
import { subjectFingerprint, verifyToken } from "@/lib/room/tokens";

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

export const Route = createFileRoute("/api/public/room/upload")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const settings = imageConfig();
        const claims = await verifyToken(request.headers.get("x-room-upload-token"), "upload");
        if (!claims) return json({ error: "unauthorized" }, 401);

        const raw = new Uint8Array(await request.arrayBuffer());
        if (!raw.length) return json({ error: "empty_body" }, 400);
        if (raw.length > settings.maxImageBytes) return json({ error: "image_too_large" }, 413);

        const db = await getDb();
        const row = await getImageRow(db, claims.imageId);
        if (!row) return json({ error: "not_found" }, 404);
        if (row.moderation_status !== "pending" || row.uploaded) {
          return json({ error: "already_uploaded" }, 409);
        }

        const sanitized = sanitizeImage(raw);
        if (!sanitized || !ALLOWED_MIME.includes(sanitized.mime)) {
          await updateImageRow(db, row.id, {
            moderation_status: "failed",
            moderation_reason: "unsupported_or_corrupt",
          });
          return json({ error: "image_type_unsupported" }, 415);
        }

        const checksum = await sha256Hex(sanitized.bytes);
        if (await findDuplicate(db, row.room_id, checksum, row.id)) {
          await updateImageRow(db, row.id, {
            moderation_status: "failed",
            moderation_reason: "duplicate",
          });
          await removeStorageObjects(db, [row.storage_path]);
          return json({ error: "image_duplicate" }, 409);
        }

        await uploadObject(db, row.storage_path, sanitized.bytes, sanitized.mime);
        await updateImageRow(db, row.id, {
          uploaded: true,
          mime_type: sanitized.mime,
          file_size: sanitized.bytes.length,
          width: sanitized.width,
          height: sanitized.height,
          checksum,
        });

        return json({
          uploaded: true,
          status: "pending",
          message: "Bild wird geprüft …",
          next_step: "Call finalize_image_upload to start the safety review.",
        });
      },
    },
  },
});
