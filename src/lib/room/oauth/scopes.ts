/**
 * Scope catalogue of the Crawler Room authorization server.
 *
 * The scope a tool call needs is DERIVED from the checked-in action matrix,
 * never hand-maintained:
 *
 * - a publicly readable action needs no scope at all (anonymous read),
 * - every other read needs `room:private`,
 * - every state-changing action needs `room:write`.
 *
 * A token therefore cannot write just because it can read: the two
 * capabilities are separate scopes and the consent screen shows them apart.
 */
import { ACTION_MATRIX } from "../actions.matrix";
import { isPublicAction } from "../mcp.surface";
import {
  BASE_SCOPES,
  parseScope,
  SCOPE_PRIVATE,
  SCOPE_WRITE,
  SUPPORTED_SCOPES,
} from "./catalog";

export {
  BASE_SCOPES,
  parseScope,
  SCOPE_OPENID,
  SCOPE_PRIVATE,
  SCOPE_PROFILE,
  SCOPE_WRITE,
  SUPPORTED_SCOPES,
} from "./catalog";

/** Default grant when a client requests nothing specific. */
export const DEFAULT_SCOPES: string[] = [...SUPPORTED_SCOPES];

/** Intersection of the requested scopes with what this server supports. */
export function negotiateScopes(requested: unknown): string[] {
  const wanted = parseScope(requested);
  if (wanted.length === 0) return [...DEFAULT_SCOPES];
  const granted: string[] = SUPPORTED_SCOPES.filter((scope) => wanted.includes(scope));
  for (const base of BASE_SCOPES) if (!granted.includes(base)) granted.unshift(base);
  return [...new Set(granted)];
}

/**
 * The scope one tool action requires, or `null` for a publicly readable
 * action. Unknown actions fail closed on the strongest scope.
 */
export function requiredScope(tool: string, action: unknown): string | null {
  if (isPublicAction(tool, action)) return null;
  if (typeof action !== "string") return SCOPE_WRITE;
  const effect = ACTION_MATRIX[tool]?.[action];
  if (!effect) return SCOPE_WRITE;
  return effect.write ? SCOPE_WRITE : SCOPE_PRIVATE;
}

/** All scopes a tool can possibly need — advertised in `tools/list`. */
export function scopesForTool(tool: string): string[] {
  const scopes = new Set<string>(BASE_SCOPES);
  for (const action of Object.keys(ACTION_MATRIX[tool] ?? {})) {
    const scope = requiredScope(tool, action);
    if (scope) scopes.add(scope);
  }
  return [...scopes];
}

export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: "Deine anonyme Crawler-Room-Verbindung bestätigen",
  profile: "Dein öffentliches Crawler Room-Basisprofil teilen",
  "room:private": "Deine privaten Räume, Benachrichtigungen und Analytics lesen",
  "room:write": "In deinem Namen schreiben, folgen, liken und verwalten",
};
