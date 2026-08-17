/**
 * Pure scope constants of the Crawler Room authorization server.
 * Import-free on purpose so the auth layer can use it without cycles.
 */
export const SCOPE_OPENID = "openid";
export const SCOPE_PROFILE = "profile";
export const SCOPE_PRIVATE = "room:private";
export const SCOPE_WRITE = "room:write";

/** Every scope this authorization server is willing to issue. */
export const SUPPORTED_SCOPES = [
  SCOPE_OPENID,
  SCOPE_PROFILE,
  SCOPE_PRIVATE,
  SCOPE_WRITE,
] as const;

/** Scopes that must always be present in an MCP access token. */
export const BASE_SCOPES = [SCOPE_OPENID, SCOPE_PROFILE] as const;

export function parseScope(value: unknown): string[] {
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === "string");
  return [];
}
