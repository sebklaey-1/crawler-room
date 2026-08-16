/**
 * Server-only data access for image messages and private storage.
 * The browser never talks to this module; every call runs inside a request
 * handler with the service role key.
 */
import { IMAGE_BUCKET, retentionCutoffIso } from "./config";
import { roomError } from "./errors";
import type { Db, MembershipContext } from "./store";

export interface ImageRow {
  id: number;
  room_id: string;
  sender_membership_id: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  checksum: string | null;
  uploaded: boolean;
  moderation_status: "pending" | "approved" | "rejected" | "failed";
  moderation_reason: string | null;
  created_at: string;
  approved_at: string | null;
}

const COLUMNS =
  "id, room_id, sender_membership_id, storage_path, mime_type, file_size, width, height, alt_text, checksum, uploaded, moderation_status, moderation_reason, created_at, approved_at";

export async function createImageRow(
  db: Db,
  membership: MembershipContext,
  storagePath: string,
  mimeType: string,
): Promise<ImageRow> {
  const { data, error } = await db
    .from("image_messages")
    .insert({
      room_id: membership.roomId,
      sender_membership_id: membership.membershipId,
      storage_path: storagePath,
      mime_type: mimeType,
    })
    .select(COLUMNS)
    .single();
  if (error || !data) throw roomError("INTERNAL_ERROR");
  return data as unknown as ImageRow;
}

export async function getImageRow(db: Db, id: number): Promise<ImageRow | null> {
  const { data, error } = await db
    .from("image_messages")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw roomError("INTERNAL_ERROR");
  return (data as unknown as ImageRow) ?? null;
}

export async function updateImageRow(db: Db, id: number, patch: Record<string, unknown>) {
  const { error } = await db.from("image_messages").update(patch).eq("id", id);
  if (error) throw roomError("INTERNAL_ERROR");
}

export async function deleteImageRow(db: Db, row: Pick<ImageRow, "id" | "storage_path">) {
  // Queue first: the object must never become unreachable garbage because the
  // row disappeared before the storage delete was recorded.
  await queueStorageDeletion(db, [row.storage_path]);
  await db.from("image_messages").delete().eq("id", row.id);
  await removeStorageObjects(db, [row.storage_path]);
}


export async function findDuplicate(
  db: Db,
  roomId: string,
  checksum: string,
  exceptId: number,
): Promise<boolean> {
  const { data, error } = await db
    .from("image_messages")
    .select("id")
    .eq("room_id", roomId)
    .eq("checksum", checksum)
    .neq("id", exceptId)
    .neq("moderation_status", "rejected")
    .limit(1);
  if (error) throw roomError("INTERNAL_ERROR");
  return (data ?? []).length > 0;
}

/** Approved images of a room, newest-first limited by retention, returned oldest-first. */
export async function listApprovedImages(
  db: Db,
  roomId: string,
  limit: number,
): Promise<ImageRow[]> {
  const { data, error } = await db
    .from("image_messages")
    .select(COLUMNS)
    .eq("room_id", roomId)
    .eq("moderation_status", "approved")
    .gte("created_at", retentionCutoffIso())
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw roomError("INTERNAL_ERROR");
  return ((data ?? []) as unknown as ImageRow[]).reverse();
}

/** Pending / rejected images of one sender — never visible to anybody else. */
export async function listOwnUnpublishedImages(
  db: Db,
  roomId: string,
  membershipId: string,
): Promise<ImageRow[]> {
  const { data, error } = await db
    .from("image_messages")
    .select(COLUMNS)
    .eq("room_id", roomId)
    .eq("sender_membership_id", membershipId)
    .in("moderation_status", ["pending", "rejected", "failed"])
    .gte("created_at", retentionCutoffIso())
    .order("created_at", { ascending: true });
  if (error) throw roomError("INTERNAL_ERROR");
  return (data ?? []) as unknown as ImageRow[];
}

/* ------------------------------- storage -------------------------------- */

export async function uploadObject(db: Db, path: string, bytes: Uint8Array, mime: string) {
  const body = new Uint8Array(bytes);
  const { error } = await db.storage.from(IMAGE_BUCKET).upload(path, body, {
    contentType: mime,
    upsert: true,
  });
  if (error) throw roomError("INTERNAL_ERROR");
}

export async function downloadObject(db: Db, path: string): Promise<Uint8Array | null> {
  const { data, error } = await db.storage.from(IMAGE_BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** Deterministic object variants of one stored image (original + thumbnail). */
export function storageVariants(path: string): string[] {
  return [path, path.replace(/(\.[a-z0-9]+)?$/i, "_thumb$1")];
}

/**
 * Records the deterministic storage paths in the persistent deletion queue.
 * Always runs *before* the owning `image_messages` row disappears.
 */
export async function queueStorageDeletion(db: Db, paths: string[]): Promise<void> {
  const cleaned = paths.filter(Boolean);
  if (!cleaned.length) return;
  await db.rpc("queue_storage_deletion", { p_paths: cleaned });
}

export interface StorageRemovalResult {
  removed: string[];
  failed: string[];
  errorCategory?: string;
}

/** Coarse, non-identifying failure category. Never contains a path or URL. */
function errorCategory(error: { message?: string; statusCode?: string } | null): string {
  const status = String((error as { statusCode?: string } | null)?.statusCode ?? "");
  if (status === "404") return "not_found";
  if (status === "403" || status === "401") return "forbidden";
  if (status.startsWith("5")) return "upstream_error";
  return "storage_error";
}

/**
 * Deletes objects from the private bucket and keeps the persistent queue in
 * sync: success clears the entry, failure increases `attempts`, stores a safe
 * category and schedules a bounded backoff. The failure is reported to the
 * caller instead of being swallowed. Missing objects count as cleaned up.
 */
export async function removeStorageObjects(
  db: Db,
  paths: string[],
): Promise<StorageRemovalResult> {
  const cleaned = Array.from(new Set(paths.filter(Boolean)));
  if (!cleaned.length) return { removed: [], failed: [] };

  const removed: string[] = [];
  const failed: string[] = [];
  let category: string | undefined;

  // One path at a time: a single failing object must not block the others.
  for (const path of cleaned) {
    const { error } = await db.storage.from(IMAGE_BUCKET).remove(storageVariants(path));
    const kind = error ? errorCategory(error as { statusCode?: string; message?: string }) : null;
    if (!error || kind === "not_found") {
      removed.push(path);
    } else {
      failed.push(path);
      category = kind ?? "storage_error";
    }
  }

  if (removed.length) await db.rpc("complete_storage_deletion", { p_paths: removed });
  if (failed.length) {
    await db.rpc("fail_storage_deletion", {
      p_paths: failed,
      p_category: category ?? "storage_error",
    });
    // Structured, content-free operational signal — never a path, URL or token.
    console.warn(
      JSON.stringify({
        service: "room-mcp",
        op: "storage_remove_failed",
        count: failed.length,
        category: category ?? "storage_error",
      }),
    );
  }
  return { removed, failed, ...(category ? { errorCategory: category } : {}) };
}

/** Retries every due queue entry in bounded, idempotent batches. */
export async function processDeletionQueue(
  db: Db,
  limit = 100,
): Promise<{ processed: number; removed: number; failed: number }> {
  const { data, error } = await db.rpc("due_storage_deletions", { p_limit: limit });
  if (error) return { processed: 0, removed: 0, failed: 0 };
  const paths = ((data ?? []) as Array<{ storage_path: string }>).map((row) => row.storage_path);
  if (!paths.length) return { processed: 0, removed: 0, failed: 0 };
  const result = await removeStorageObjects(db, paths);
  return {
    processed: paths.length,
    removed: result.removed.length,
    failed: result.failed.length,
  };
}


export async function signedUrl(db: Db, path: string, ttlSeconds: number): Promise<string | null> {
  const { data, error } = await db.storage.from(IMAGE_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/* ------------------------------ retention ------------------------------- */

/** Hard 24h cap plus the newest-7 limit for a room's text messages. */
export async function enforceTextRetention(db: Db, roomId: string) {
  const { error } = await db.rpc("enforce_text_retention", { p_room_id: roomId });
  if (error) throw roomError("INTERNAL_ERROR");
}

/**
 * Deletes expired (older than 24 hours) and excess images of a room and
 * removes the matching objects from the private bucket. Storage errors are
 * surfaced, never silently swallowed.
 */
export async function enforceImageRetention(db: Db, roomId: string) {
  const { data, error } = await db.rpc("enforce_image_retention", { p_room_id: roomId });
  if (error) throw roomError("INTERNAL_ERROR");
  const paths = ((data ?? []) as Array<{ storage_path: string }>).map((row) => row.storage_path);
  await removeStorageObjects(db, paths);
  return paths;
}

/**
 * Opportunistic per-room retention. Runs on every write path so the hard
 * 24 hour cap is enforced even when the maintenance job has not run yet.
 * Never throws: a write must not fail because a cleanup failed, and the
 * read filters keep expired content invisible in the meantime.
 */
export async function enforceRoomRetention(db: Db, roomId: string): Promise<void> {
  try {
    await enforceTextRetention(db, roomId);
  } catch {
    // retried by the next write and by the maintenance job
  }
  try {
    await enforceImageRetention(db, roomId);
  } catch {
    // storage removal is idempotent; a failed path is retried by sweepImages
  }
}

/** Fallback sweep: dead uploads, orphaned files and both per-room limits. */
export async function sweepImages(db: Db): Promise<{ purged: number; retention: number }> {
  const { data: dead } = await db.rpc("purge_dead_images");
  const deadPaths = ((dead ?? []) as Array<{ storage_path: string }>).map(
    (row) => row.storage_path,
  );
  await removeStorageObjects(db, deadPaths);

  const { data: excess } = await db.rpc("enforce_all_retention");
  const excessPaths = ((excess ?? []) as Array<{ storage_path: string }>).map(
    (row) => row.storage_path,
  );
  await removeStorageObjects(db, excessPaths);

  return { purged: deadPaths.length, retention: excessPaths.length };
}

/** Sender aliases for a set of image rows (no other membership data leaves the server). */
export async function aliasesFor(db: Db, membershipIds: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(membershipIds));
  if (!unique.length) return {};
  const { data } = await db.from("memberships").select("id, alias").in("id", unique);
  const map: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ id: string; alias: string }>) map[row.id] = row.alias;
  return map;
}
