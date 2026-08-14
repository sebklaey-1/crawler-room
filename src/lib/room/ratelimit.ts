/**
 * Simple database-backed rate limiting per subject_hash.
 * Stored events contain no message content.
 */
import { roomError } from "./errors";
import type { Db } from "./store";

export type RateAction =
  | "message"
  | "join"
  | "report"
  | "upload"
  | "like"
  | "profile_image";

interface Window {
  seconds: number;
  max: number;
}

export async function enforceRateLimit(db: Db, subjectHash: string, action: RateAction, windows: Window[]) {
  const now = Date.now();
  const oldest = Math.max(...windows.map((w) => w.seconds));
  const since = new Date(now - oldest * 1000).toISOString();

  const { data, error } = await db
    .from("rate_events")
    .select("created_at")
    .eq("subject_hash", subjectHash)
    .eq("action", action)
    .gte("created_at", since);
  if (error) throw roomError("INTERNAL_ERROR");

  const timestamps = ((data ?? []) as Array<{ created_at: string }>).map((row) =>
    new Date(row.created_at).getTime(),
  );

  for (const window of windows) {
    const threshold = now - window.seconds * 1000;
    const count = timestamps.filter((timestamp) => timestamp >= threshold).length;
    if (count >= window.max) throw roomError("RATE_LIMITED");
  }

  const { error: insertError } = await db
    .from("rate_events")
    .insert({ subject_hash: subjectHash, action });
  if (insertError) throw roomError("INTERNAL_ERROR");
}

export const WINDOWS = {
  message: (perMinute: number, perHour: number): Window[] => [
    { seconds: 60, max: perMinute },
    { seconds: 3600, max: perHour },
  ],
  join: (perHour: number): Window[] => [{ seconds: 3600, max: perHour }],
  report: (perHour: number): Window[] => [{ seconds: 3600, max: perHour }],
};
