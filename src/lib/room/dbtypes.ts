/**
 * Shared, `any`-free typing helpers for database rows and tool payloads.
 *
 * The Supabase client used by this server is intentionally schema-loose (the
 * MCP layer talks to many tables and only ever projects explicit columns), so
 * these helpers give call sites a precise, checked shape instead of `any`.
 */

/** A row as returned by PostgREST: string keys, unknown values. */
export type Row = Record<string, unknown>;

/**
 * PostgREST embeds a to-one relation as an array in the inferred type.
 * Normalises both shapes to a single row (or null) with the caller's type.
 */
export function embedded<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value as T;
}

/** Narrows an unvalidated tool payload to a read-only object view. */
export function payloadOf<T extends object>(input: unknown): Partial<T> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {} as Partial<T>;
  return input as Partial<T>;
}

/** Reads a string field from an untyped row, or null. */
export function strField(row: unknown, key: string): string | null {
  if (!row || typeof row !== "object") return null;
  const value = (row as Row)[key];
  return typeof value === "string" ? value : null;
}

/** Reads a finite number field from an untyped row, or null. */
export function numField(row: unknown, key: string): number | null {
  if (!row || typeof row !== "object") return null;
  const value = (row as Row)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Normalises a PostgREST list result to an array of rows. */
export function rowsOf<T = Row>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

/** Column shapes of the to-one relations this server embeds in selects. */
export interface EmbeddedShapes {
  memberships: { alias?: string | null; subject_hash?: string | null };
  rooms: { room_number?: number | null; capacity?: number | null; title?: string | null };
  topics: { slug?: string | null; display_name?: string | null };
  accounts: { display_alias?: string | null };
  user_rooms: {
    handle?: string | null;
    room_name?: string | null;
    description?: string | null;
    room_id?: string | null;
    id?: string | null;
  };
  organizations: { name?: string | null; verified?: boolean | null };
}
