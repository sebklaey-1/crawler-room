/**
 * Runtime output contract enforcement.
 *
 * The published `outputSchema` of every tool is the single source of truth:
 * for each action exactly one `oneOf` branch exists, and only the fields that
 * branch declares may leave the server. Anything else — internal UUIDs,
 * account/owner ids, subject or auth hashes, storage paths, database errors,
 * trace data — is removed before the MCP response is built.
 *
 * A missing branch is treated as an internal schema error: the caller gets a
 * generic INTERNAL_ERROR, never the raw object and never a stack trace.
 */

type Json = Record<string, unknown>;

/** Keys that must never appear in a public payload, at any nesting depth. */
const FORBIDDEN_KEY = /(subject_hash|auth_user|owner_account|account_id|membership_id|_path$|^path$|^stack$|^trace|^db_error$|^hint$|^details$|^session|^raw_)/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keys allowed to carry a URL value (signed, short-lived storage URLs). */
const URL_KEYS = /(^url$|_url$)/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 12) return null;
  if (Array.isArray(value)) return value.map((entry) => scrub(entry, depth + 1));
  if (value && typeof value === "object") {
    const out: Json = {};
    for (const [key, item] of Object.entries(value as Json)) {
      if (FORBIDDEN_KEY.test(key)) continue;
      // A raw UUID is always an internal identifier — opaque ids are prefixed.
      if (typeof item === "string" && UUID.test(item) && !URL_KEYS.test(key)) continue;
      out[key] = scrub(item, depth + 1);
    }
    return out;
  }
  return value;
}

export class OutputContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputContractError";
  }
}

interface Branch {
  action: string;
  keys: Set<string>;
}

const branchCache = new WeakMap<object, Map<string, Branch>>();

/** Reads the action branches out of a published `oneOf` output schema. */
export function branchesOf(outputSchema: unknown): Map<string, Branch> {
  const schema = outputSchema as { oneOf?: unknown[] } | undefined;
  if (!schema || typeof schema !== "object") return new Map();
  const cached = branchCache.get(schema as object);
  if (cached) return cached;

  const map = new Map<string, Branch>();
  for (const raw of schema.oneOf ?? []) {
    const properties = (raw as { properties?: Json })?.properties ?? {};
    const action = (properties["action"] as { const?: unknown } | undefined)?.const;
    if (typeof action !== "string") continue;
    map.set(action, { action, keys: new Set(Object.keys(properties)) });
  }
  branchCache.set(schema as object, map);
  return map;
}

/**
 * Validates a successful handler return against the published contract and
 * reduces it to the declared fields. Throws `OutputContractError` when the
 * action is missing or unknown.
 */
export function enforceOutputContract(outputSchema: unknown, result: unknown): Json {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new OutputContractError("handler result is not an object");
  }
  const branches = branchesOf(outputSchema);
  if (!branches.size) throw new OutputContractError("output schema has no action branches");

  const raw = result as Json;
  const action = raw["action"];
  if (typeof action !== "string") throw new OutputContractError("handler result has no action");
  const branch = branches.get(action);
  if (!branch) throw new OutputContractError(`no output branch for action «${action}»`);

  const out: Json = {};
  for (const key of branch.keys) {
    if (key === "action") continue;
    if (!(key in raw)) continue;
    const value = scrub(raw[key]);
    if (value === undefined) continue;
    out[key] = value;
  }
  return { action, ...out };
}
