/**
 * Minimal chainable Supabase stub for permission/routing tests.
 * Every builder method returns the same thenable object, resolving to the
 * result configured for the queried table.
 */
export interface TableResult {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  count?: number;
}

const METHODS = [
  "select",
  "insert",
  "update",
  "delete",
  "upsert",
  "eq",
  "neq",
  "is",
  "in",
  "gt",
  "gte",
  "lt",
  "lte",
  "ilike",
  "like",
  "or",
  "not",
  "order",
  "limit",
  "range",
  "maybeSingle",
  "single",
] as const;

function builder(result: TableResult, methodLog: string[] = []) {
  const target: any = {};
  for (const method of METHODS)
    target[method] = () => {
      methodLog.push(method);
      return target;
    };
  target.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: null, error: null, count: 0, ...result }).then(resolve, reject);
  return target;
}

export function fakeDb(tables: Record<string, TableResult> = {}) {
  const calls: Array<{ table: string }> = [];
  /** Every builder method used, so tests can assert read-only behaviour. */
  const methods: string[] = [];
  const db: any = {
    calls,
    methods,
    from(table: string) {
      calls.push({ table });
      return builder(tables[table] ?? {}, methods);
    },
    async rpc(name: string) {
      methods.push(`rpc:${name}`);
      return { data: null, error: null };
    },
  };
  return db;
}
