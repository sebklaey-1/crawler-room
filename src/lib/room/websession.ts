/**
 * Server-side verification of a Supabase *web* session (not an MCP token).
 * Used only by the /data-deletion page so a deletion request is provably tied
 * to the signed-in account. The raw user id stays in memory; only its keyed
 * hash is ever persisted.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { authUserHash } from "./auth";
import { roomError } from "./errors";

let client: SupabaseClient | null = null;

function verifier(): SupabaseClient {
  if (client) return client;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
  if (!url || !key) throw roomError("INTERNAL_ERROR");
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

/** Returns the keyed account hash for a valid web session token, else null. */
export async function webSessionHash(token: string | null): Promise<string | null> {
  if (!token || token.length > 8192) return null;
  try {
    const { data, error } = await verifier().auth.getUser(token);
    const id = data?.user?.id;
    if (error || !id) return null;
    return await authUserHash(id);
  } catch {
    return null;
  }
}
