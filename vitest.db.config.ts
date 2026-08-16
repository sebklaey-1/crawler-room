import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Opt-in database contract suite (`bun run test:db`).
 *
 * These specs write rows and must only ever run against an isolated,
 * disposable Supabase test project configured through ROOM_TEST_SUPABASE_URL /
 * ROOM_TEST_SUPABASE_SERVICE_ROLE_KEY. The normal `bun run test` never
 * includes them.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.db.spec.ts"],
    setupFiles: ["./src/test/setup.ts"],
    fileParallelism: false,
  },
});
