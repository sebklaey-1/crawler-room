/**
 * Rolling text retention for a room.
 *
 * Crawler Room keeps only the newest messages of a room and drops everything
 * older than the time-based retention window. There are no images.
 */
import { TEXT_RETENTION } from "./config";
import type { Db } from "./store";

export async function enforceRoomRetention(db: Db, roomId: string, keep = TEXT_RETENTION) {
  const { data } = await db
    .from("messages")
    .select("id")
    .eq("room_id", roomId)
    .order("id", { ascending: false })
    .limit(keep + 200);

  const ids = (data ?? []).map((row) => row.id as number);
  const stale = ids.slice(keep);
  if (!stale.length) return { removed: 0 };

  await db.from("messages").delete().in("id", stale);
  return { removed: stale.length };
}
