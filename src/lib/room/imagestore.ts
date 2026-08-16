/**
 * Server-only data access for image messages and private storage.
 * The browser never talks to this module; every call runs inside a request
 * handler with the service role key.
 */
import { IMAGE_BUCKET } from "./config";
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
  await removeStorageObjects(db, [row.storage_path]);
  await db.from("image_messages").delete().eq("id", row.id);
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

export async function removeStorageObjects(db: Db, paths: string[]) {
  const cleaned = paths.filter(Boolean);
  if (!cleaned.length) return;
  // Originals plus any derived thumbnail variant.
  const all = cleaned.flatMap((path) => [path, path.replace(/(\.[a-z0-9]+)?$/i, "_thumb$1")]);
  await db.storage.from(IMAGE_BUCKET).remove(all);
}

export async function signedUrl(db: Db, path: string, ttlSeconds: number): Promise<string | null> {
  const { data, error } = await db.storage.from(IMAGE_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/* ------------------------------ retention ------------------------------- */

/** Keeps only the newest 7 text messages of a room. */
export async function enforceTextRetention(db: Db, roomId: string) {
  const { error } = await db.rpc("enforce_text_retention", { p_room_id: roomId });
  if (error) throw roomError("INTERNAL_ERROR");
}

/** Keeps only the newest 3 approved images of a room, deleting files as well. */
export async function enforceImageRetention(db: Db, roomId: string) {
  const { data, error } = await db.rpc("enforce_image_retention", { p_room_id: roomId });
  if (error) throw roomError("INTERNAL_ERROR");
  const paths = ((data ?? []) as Array<{ storage_path: string }>).map((row) => row.storage_path);
  await removeStorageObjects(db, paths);
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
